import { describe, expect, it, vi } from "vitest";
import { upsertIdentityMap } from "@/lib/highlevel/identity";
import { linkHighLevelCustomerContact } from "@/lib/highlevel/identity-link";
import { HIGHLEVEL_PROVIDER_KEY } from "@/lib/highlevel/config";

function memoryPrisma(existing: Array<Record<string, string>>) {
  const rows = [...existing];
  function matchesExternal(row: Record<string, string>, key: Record<string, string>) {
    return (
      row.companyId === key.companyId &&
      row.provider === key.provider &&
      row.entityType === key.entityType &&
      row.externalId === key.externalId
    );
  }
  return {
    rows,
    providerIdentityMap: {
      findFirst: async ({ where }: { where: Record<string, string> }) =>
        rows.find(
          (row) =>
            row.companyId === where.companyId &&
            row.provider === where.provider &&
            row.entityType === where.entityType &&
            (!where.internalId || row.internalId === where.internalId) &&
            (!where.externalId || row.externalId === where.externalId)
        ) ?? null,
      create: async ({ data }: { data: Record<string, string> }) => {
        if (
          rows.some(
            (row) =>
              row.companyId === data.companyId &&
              row.provider === data.provider &&
              row.entityType === data.entityType &&
              row.externalId === data.externalId
          )
        ) {
          throw new Error(
            "Unique constraint failed on the fields: (`companyId`,`provider`,`entityType`,`externalId`)"
          );
        }
        if (
          rows.some(
            (row) =>
              row.companyId === data.companyId &&
              row.provider === data.provider &&
              row.entityType === data.entityType &&
              row.internalId === data.internalId
          )
        ) {
          throw new Error(
            "Unique constraint failed on the fields: (`companyId`,`provider`,`entityType`,`internalId`)"
          );
        }
        const created = { id: `map_${rows.length + 1}`, ...data };
        rows.push(created);
        return created;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, string> }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error("missing");
        Object.assign(row, data);
        return row;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { companyId_provider_entityType_externalId: Record<string, string> };
        create: Record<string, string>;
        update: Record<string, string>;
      }) => {
        const key = where.companyId_provider_entityType_externalId;
        const existing = rows.find((row) => matchesExternal(row, key));
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        if (
          rows.some(
            (row) =>
              row.companyId === create.companyId &&
              row.provider === create.provider &&
              row.entityType === create.entityType &&
              (row.externalId === create.externalId || row.internalId === create.internalId)
          )
        ) {
          throw new Error(
            "Unique constraint failed on the fields: (`companyId`,`provider`,`entityType`,`externalId`)"
          );
        }
        const created = { id: `map_${rows.length + 1}`, ...create };
        rows.push(created);
        return created;
      },
    },
    customer: {
      findFirst: async (): Promise<{
        id: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        email: string | null;
        secondaryPhone: string | null;
      } | null> => null,
    },
  };
}

describe("HighLevel ProviderIdentityMap uniqueness", () => {
  it("reuses an existing externalId mapping instead of inserting a duplicate", async () => {
    const prisma = memoryPrisma([
      {
        id: "map_existing",
        companyId: "co_865",
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: "cust_sync",
        externalId: "hl_contact_existing",
      },
    ]);
    const reused = await upsertIdentityMap(prisma as never, {
      companyId: "co_865",
      entityType: "CUSTOMER",
      internalId: "cust_outbound",
      externalId: "hl_contact_existing",
    });
    expect(reused.id).toBe("map_existing");
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]?.externalId).toBe("hl_contact_existing");
  });

  it("links the same HighLevel contact twice without a unique-constraint exception", async () => {
    const prisma = memoryPrisma([
      {
        id: "map_existing",
        companyId: "co_865",
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: "cust_a",
        externalId: "hl_contact_existing",
      },
    ]);
    const first = await linkHighLevelCustomerContact(prisma as never, {
      companyId: "co_865",
      customerId: "cust_a",
      contactId: "hl_contact_existing",
      customerPhone: "8658514300",
      contactPhone: "+18658514300",
    });
    const second = await linkHighLevelCustomerContact(prisma as never, {
      companyId: "co_865",
      customerId: "cust_a",
      contactId: "hl_contact_existing",
      customerPhone: "(865) 851-4300",
      contactPhone: "1-865-851-4300",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.contactId).toBe("hl_contact_existing");
      expect(second.reused).toBe(true);
    }
    expect(prisma.rows).toHaveLength(1);
  });

  it("blocks a mismatched HighLevel contact already owned by another customer", async () => {
    const prisma = memoryPrisma([
      {
        id: "map_other",
        companyId: "co_865",
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: "cust_other",
        externalId: "hl_contact_existing",
      },
    ]);
    prisma.customer.findFirst = async () => ({
      id: "cust_other",
      firstName: "Other",
      lastName: "Customer",
      phone: "+18655550199",
      email: "other@example.com",
      secondaryPhone: null,
    });
    const result = await linkHighLevelCustomerContact(prisma as never, {
      companyId: "co_865",
      customerId: "cust_a",
      contactId: "hl_contact_existing",
      customerPhone: "8658514300",
      contactPhone: "+18655550199",
      customerEmail: "a@example.com",
      contactEmail: "other@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already linked/i);
    expect(prisma.rows[0]?.internalId).toBe("cust_other");
  });

  it("repairs a stale mapping when strong phone evidence matches only the current customer", async () => {
    const prisma = memoryPrisma([
      {
        id: "map_stale",
        companyId: "co_865",
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: "cust_old",
        externalId: "hl_contact_existing",
      },
    ]);
    prisma.customer.findFirst = async () => ({
      id: "cust_old",
      firstName: "Old",
      lastName: "Record",
      phone: "+18655550000",
      email: "old@example.com",
      secondaryPhone: null,
    });
    const result = await linkHighLevelCustomerContact(prisma as never, {
      companyId: "co_865",
      customerId: "cust_new",
      contactId: "hl_contact_existing",
      customerPhone: "8658514300",
      contactPhone: "+18658514300",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repaired).toBe(true);
    expect(prisma.rows[0]?.internalId).toBe("cust_new");
    expect(prisma.rows).toHaveLength(1);
  });

  it("never merges by name alone", async () => {
    const prisma = memoryPrisma([
      {
        id: "map_other",
        companyId: "co_865",
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: "cust_other",
        externalId: "hl_contact_existing",
      },
    ]);
    prisma.customer.findFirst = async () => ({
      id: "cust_other",
      firstName: "Casey",
      lastName: "Same",
      phone: "+18655550111",
      email: null,
      secondaryPhone: null,
    });
    const result = await linkHighLevelCustomerContact(prisma as never, {
      companyId: "co_865",
      customerId: "cust_a",
      contactId: "hl_contact_existing",
      customerPhone: "8658514300",
      contactPhone: "+18655550111",
    });
    expect(result.ok).toBe(false);
  });

  it("keeps tenant scope on identity queries", async () => {
    const findFirst = vi.fn(async () => null);
    const upsert = vi.fn(async ({ create }) => ({ id: "new", ...create }));
    const prisma = {
      providerIdentityMap: { findFirst, upsert },
    };
    await upsertIdentityMap(prisma as never, {
      companyId: "co_a",
      entityType: "CUSTOMER",
      internalId: "cust_a",
      externalId: "hl_1",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "co_a",
          provider: HIGHLEVEL_PROVIDER_KEY,
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_provider_entityType_externalId: expect.objectContaining({
            companyId: "co_a",
            provider: HIGHLEVEL_PROVIDER_KEY,
            entityType: "CUSTOMER",
            externalId: "hl_1",
          }),
        },
      }),
    );
  });

  it("recreates the production unique-constraint failure after communications sync", async () => {
    const prisma = memoryPrisma([
      {
        id: "map_sync",
        companyId: "co_865",
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: "cust_synced",
        externalId: "hl_contact_synced",
      },
    ]);
    const outbound = upsertIdentityMap(prisma as never, {
      companyId: "co_865",
      entityType: "CUSTOMER",
      internalId: "cust_synced",
      externalId: "hl_contact_synced",
    });
    const linked = linkHighLevelCustomerContact(prisma as never, {
      companyId: "co_865",
      customerId: "cust_synced",
      contactId: "hl_contact_synced",
      customerPhone: "8658514300",
      contactPhone: "+18658514300",
    });
    await expect(outbound).resolves.toMatchObject({ id: "map_sync", externalId: "hl_contact_synced" });
    await expect(linked).resolves.toMatchObject({ ok: true, contactId: "hl_contact_synced" });
    expect(prisma.rows).toHaveLength(1);
  });

  it("resolves the same HighLevel contact concurrently without a duplicate row", async () => {
    const prisma = memoryPrisma([]);
    const input = {
      companyId: "co_865",
      entityType: "CUSTOMER" as const,
      internalId: "cust_a",
      externalId: "hl_contact_existing",
    };
    const [first, second] = await Promise.all([
      upsertIdentityMap(prisma as never, input),
      upsertIdentityMap(prisma as never, input),
    ]);
    expect(first.externalId).toBe("hl_contact_existing");
    expect(second.externalId).toBe("hl_contact_existing");
    expect(prisma.rows).toHaveLength(1);
  });

  it("repairs a stale mapping with verified email when phones do not conflict", async () => {
    const prisma = memoryPrisma([
      {
        id: "map_stale",
        companyId: "co_865",
        provider: HIGHLEVEL_PROVIDER_KEY,
        entityType: "CUSTOMER",
        internalId: "cust_old",
        externalId: "hl_contact_existing",
      },
    ]);
    prisma.customer.findFirst = async () => ({
      id: "cust_old",
      firstName: "Old",
      lastName: "Record",
      phone: "+18655550000",
      email: "old@example.com",
      secondaryPhone: null,
    });
    const result = await linkHighLevelCustomerContact(prisma as never, {
      companyId: "co_865",
      customerId: "cust_new",
      contactId: "hl_contact_existing",
      customerEmail: "casey@865hvac.test",
      contactEmail: "Casey@865hvac.test",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repaired).toBe(true);
    expect(prisma.rows[0]?.internalId).toBe("cust_new");
  });
});
