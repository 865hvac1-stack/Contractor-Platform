import type { PrismaClient } from "@prisma/client";
import { searchHighLevelContacts, type HighLevelContact } from "@/lib/highlevel/client";
import { loadHighLevelAccess } from "@/lib/highlevel/connection";
import { assertHighLevelLocationToken } from "@/lib/highlevel/location-token";
import { matchHighLevelContact, mapContactToCustomer } from "@/lib/highlevel/contacts";
import { ingestHighLevelLead } from "@/lib/highlevel/leads";

export type SyncPreviewRow = {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  match: "existing_customer" | "new_lead" | "name_only_skipped";
  customerId: string | null;
};

export async function previewHighLevelContactSync(prisma: PrismaClient, companyId: string) {
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) throw new Error("HighLevel is not connected.");
  assertHighLevelLocationToken(access);

  const rows: SyncPreviewRow[] = [];
  let startAfterId: string | undefined;
  let pages = 0;
  while (pages < 20) {
    const page = await searchHighLevelContacts({
      accessToken: access.accessToken,
      locationId: access.locationId,
      startAfterId,
      limit: 100,
    });
    const contacts = page.contacts ?? [];
    for (const contact of contacts) {
      rows.push(await classifyContact(prisma, companyId, contact));
    }
    pages += 1;
    const next = page.meta?.startAfterId || contacts.at(-1)?.id;
    if (!contacts.length || !next || next === startAfterId) break;
    startAfterId = next;
  }

  return {
    contactsFound: rows.length,
    existingMatches: rows.filter((row) => row.match === "existing_customer").length,
    newLeads: rows.filter((row) => row.match === "new_lead").length,
    nameOnlySkipped: rows.filter((row) => row.match === "name_only_skipped").length,
    rows: rows.slice(0, 200),
  };
}

async function classifyContact(prisma: PrismaClient, companyId: string, contact: HighLevelContact): Promise<SyncPreviewRow> {
  const name = contact.name || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown";
  const match = await matchHighLevelContact(prisma, {
    companyId,
    contactId: contact.id,
    email: contact.email,
    phone: contact.phone,
    name,
  });
  return {
    contactId: contact.id,
    name,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    match:
      match.kind === "name_only_ignored"
        ? "name_only_skipped"
        : match.customerId
          ? "existing_customer"
          : "new_lead",
    customerId: match.customerId,
  };
}

export async function applyHighLevelContactSync(prisma: PrismaClient, companyId: string, actorId: string) {
  const preview = await previewHighLevelContactSync(prisma, companyId);
  let mapped = 0;
  let leadsCreated = 0;
  const access = await loadHighLevelAccess(prisma, companyId);
  if (!access) throw new Error("HighLevel is not connected.");
  assertHighLevelLocationToken(access);
  let startAfterId: string | undefined;
  let pages = 0;
  while (pages < 20) {
    const page = await searchHighLevelContacts({
      accessToken: access.accessToken,
      locationId: access.locationId,
      startAfterId,
      limit: 100,
    });
    const contacts = page.contacts ?? [];
    for (const contact of contacts) {
      const classified = await classifyContact(prisma, companyId, contact);
      if (classified.match === "existing_customer" && classified.customerId) {
        await mapContactToCustomer(prisma, {
          companyId,
          customerId: classified.customerId,
          contactId: contact.id,
        });
        mapped += 1;
      } else if (classified.match === "new_lead") {
        const created = await ingestHighLevelLead(prisma, {
          companyId,
          externalId: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          source: contact.source,
          contactId: contact.id,
        });
        if (created.created) leadsCreated += 1;
      }
    }
    pages += 1;
    const next = page.meta?.startAfterId || contacts.at(-1)?.id;
    if (!contacts.length || !next || next === startAfterId) break;
    startAfterId = next;
  }
  await prisma.integrationConnection.update({
    where: { id: access.connection.id },
    data: {
      lastSyncAt: new Date(),
      lastAttemptAt: new Date(),
      healthMessage: `Initial sync mapped ${mapped} customers and created ${leadsCreated} leads.`,
    },
  });
  await prisma.integrationSync.create({
    data: {
      companyId,
      connectionId: access.connection.id,
      kind: "initial_contacts",
      status: "COMPLETED",
      finishedAt: new Date(),
      recordsIn: mapped + leadsCreated,
      recordsOut: leadsCreated,
    },
  });
  void actorId;
  return { mapped, leadsCreated, preview };
}
