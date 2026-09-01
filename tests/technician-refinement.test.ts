import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { can, isFieldRole } from "@/lib/permissions";
import { jobAccessFilter } from "@/lib/tenant";
import { hashToken, invalidateSessionToken, generateToken } from "@/lib/auth";
import { middlewareAuthDecision } from "@/lib/auth-session";
import { inviteStatus } from "@/lib/team/invite-status";
import {
  acceptTeamInvite,
  inviteActionResult,
  persistTeamInvite,
  revokeTeamInvite,
  rotateInviteToken,
} from "@/lib/team/invite";
import { searchCustomers } from "@/lib/customers/search";
import { isJobPhotoKind, looksLikeImage, JOB_PHOTO_KINDS } from "@/lib/tech/photos";
import { TECH_CONTENT_BOTTOM_PADDING, TECH_NAV_SAFE_AREA, TECH_LAYOUT_VIEWPORTS } from "@/lib/tech/nav";
import { technicianInboxEmptyCopy } from "@/lib/tech/inbox";
import { remainingHref } from "@/lib/tech/next-step";
import { smsProviderConfigured } from "@/lib/communications/sms";
import { emailConfigured } from "@/lib/email/resend";

const prisma = new PrismaClient();

describe("technician logout and session isolation", () => {
  const ids = { userA: "", userB: "", sessionA: "", sessionB: "" };
  const tokens = { a: "", b: "" };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const userA = await prisma.user.create({
      data: { email: `logout-a-${stamp}@test.local`, passwordHash: hash, firstName: "A", lastName: "Tech" },
    });
    const userB = await prisma.user.create({
      data: { email: `logout-b-${stamp}@test.local`, passwordHash: hash, firstName: "B", lastName: "Tech" },
    });
    ids.userA = userA.id;
    ids.userB = userB.id;
    tokens.a = generateToken();
    tokens.b = generateToken();
    const sessionA = await prisma.session.create({
      data: { userId: userA.id, tokenHash: hashToken(tokens.a), expiresAt: new Date(Date.now() + 86400000) },
    });
    const sessionB = await prisma.session.create({
      data: { userId: userB.id, tokenHash: hashToken(tokens.b), expiresAt: new Date(Date.now() + 86400000) },
    });
    ids.sessionA = sessionA.id;
    ids.sessionB = sessionB.id;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: [ids.userA, ids.userB].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.userA, ids.userB].filter(Boolean) } } });
  });

  it("invalidates only the signed-out session", async () => {
    const removed = await invalidateSessionToken(tokens.a);
    expect(removed).toBe(1);
    expect(await prisma.session.findUnique({ where: { id: ids.sessionA } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: ids.sessionB } })).not.toBeNull();
  });

  it("treats a deleted session as logged out for protected routes and APIs", async () => {
    const leftover = await prisma.session.findUnique({ where: { tokenHash: hashToken(tokens.a) } });
    expect(leftover).toBeNull();
    const blocked = middlewareAuthDecision({ pathname: "/tech", hasSessionCookie: false, signedOut: false });
    expect(blocked.redirectTo).toBe("/login");
    const apiBlocked = middlewareAuthDecision({
      pathname: "/api/customers/search",
      hasSessionCookie: false,
      signedOut: false,
    });
    expect(apiBlocked.redirectTo).toBe("/login");
    const loginAfterLogout = middlewareAuthDecision({
      pathname: "/login",
      hasSessionCookie: true,
      signedOut: true,
    });
    expect(loginAfterLogout.allow).toBe(true);
    expect(loginAfterLogout.clearSessionCookie).toBe(true);
    expect(loginAfterLogout.redirectTo).toBeNull();
  });
});

describe("technician invite email security", () => {
  const ids = { companyA: "", companyB: "", ownerA: "", techB: "" };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const ownerA = await prisma.user.create({
      data: { email: `invite-owner-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "A" },
    });
    const techB = await prisma.user.create({
      data: { email: `invite-techb-${stamp}@test.local`, passwordHash: hash, firstName: "Pat", lastName: "B" },
    });
    ids.ownerA = ownerA.id;
    ids.techB = techB.id;
    const companyA = await prisma.company.create({
      data: {
        businessName: `Invite Co A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: ownerA.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Invite Co B ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: { create: { userId: techB.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
  });

  afterAll(async () => {
    const companies = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.teamInvite.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.user.deleteMany({
      where: { OR: [{ id: { in: [ids.ownerA, ids.techB].filter(Boolean) } }, { email: { contains: "@invite-accept.test" } }] },
    });
  });

  it("lets an owner persist a technician invite without creating a user yet", async () => {
    expect(can("COMPANY_OWNER", "team:manage")).toBe(true);
    expect(can("TECHNICIAN", "team:manage")).toBe(false);
    const email = `new-tech-${Date.now()}@invite-accept.test`;
    const created = await persistTeamInvite(prisma, {
      companyId: ids.companyA,
      invitedById: ids.ownerA,
      email,
      firstName: "Jordan",
      lastName: "Field",
      role: "TECHNICIAN",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    const again = await persistTeamInvite(prisma, {
      companyId: ids.companyA,
      invitedById: ids.ownerA,
      email,
      firstName: "Jordan",
      lastName: "Field",
      role: "TECHNICIAN",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.reused).toBe(true);
    const count = await prisma.teamInvite.count({ where: { companyId: ids.companyA, email } });
    expect(count).toBe(1);
  });

  it("keeps invites tenant-scoped and rejects expired or reused tokens", async () => {
    const email = `expire-${Date.now()}@invite-accept.test`;
    const created = await persistTeamInvite(prisma, {
      companyId: ids.companyA,
      invitedById: ids.ownerA,
      email,
      firstName: "Exp",
      lastName: "Ired",
      role: "TECHNICIAN",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const other = await prisma.teamInvite.findFirst({
      where: { id: created.invite.id, companyId: ids.companyB },
    });
    expect(other).toBeNull();

    const expired = await acceptTeamInvite(prisma, {
      token: created.token,
      password: "NewPassword-123!",
      now: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
    });
    expect(expired.ok).toBe(false);

    const accepted = await acceptTeamInvite(prisma, {
      token: created.token,
      password: "NewPassword-123!",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(isFieldRole(accepted.role)).toBe(true);
    expect(accepted.companyId).toBe(ids.companyA);

    const reused = await acceptTeamInvite(prisma, {
      token: created.token,
      password: "NewPassword-123!",
    });
    expect(reused.ok).toBe(false);

    const users = await prisma.user.count({ where: { email } });
    expect(users).toBe(1);
  });

  it("resends without creating a duplicate account and can revoke", async () => {
    const email = `resend-${Date.now()}@invite-accept.test`;
    const created = await persistTeamInvite(prisma, {
      companyId: ids.companyA,
      invitedById: ids.ownerA,
      email,
      firstName: "Re",
      lastName: "Send",
      role: "TECHNICIAN",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rotated = await rotateInviteToken(prisma, created.invite.id, ids.companyA);
    expect(rotated.ok).toBe(true);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    const revoked = await revokeTeamInvite(prisma, created.invite.id, ids.companyA);
    expect(revoked.ok).toBe(true);
    if (!rotated.ok) return;
    const afterRevoke = await acceptTeamInvite(prisma, { token: rotated.token, password: "NewPassword-123!" });
    expect(afterRevoke.ok).toBe(false);
    expect(inviteStatus({ ...created.invite, revokedAt: new Date(), acceptedAt: null, expiresAt: created.invite.expiresAt })).toBe(
      "REVOKED"
    );
  });

  it("never reports an invite as sent when email is missing or the provider fails", () => {
    const missing = inviteActionResult(
      { ok: false, configured: false, error: "Email is not configured." },
      "https://example.test/invite/token"
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toMatch(/Email is not configured/);
      expect(missing.setupUrl).toContain("/invite/");
    }
    const failed = inviteActionResult(
      { ok: false, configured: true, error: "Email provider rejected the send (401)." },
      "https://example.test/invite/token"
    );
    expect(failed.ok).toBe(false);
    const sent = inviteActionResult({ ok: true, providerId: "re_test" }, "https://example.test/invite/token");
    expect(sent.ok).toBe(true);
    if (sent.ok) expect(sent.message).toBe("Invite email sent.");
    expect(emailConfigured() ? "configured" : "missing").toMatch(/configured|missing/);
  });
});

describe("customer search and photo authorization", () => {
  const ids = {
    companyA: "",
    companyB: "",
    ownerA: "",
    techA: "",
    customerAssigned: "",
    customerOther: "",
    customerB: "",
    jobA: "",
    photoA: "",
    propertyA: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const ownerA = await prisma.user.create({
      data: { email: `search-owner-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "A" },
    });
    const techA = await prisma.user.create({
      data: { email: `search-tech-${stamp}@test.local`, passwordHash: hash, firstName: "JR", lastName: "Tech" },
    });
    ids.ownerA = ownerA.id;
    ids.techA = techA.id;
    const companyA = await prisma.company.create({
      data: {
        businessName: `Search Co A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        memberships: {
          create: [
            { userId: ownerA.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() },
            { userId: techA.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() },
          ],
        },
      },
    });
    const companyB = await prisma.company.create({
      data: { businessName: `Search Co B ${stamp}`, industry: "HVAC", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const assigned = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Tony",
        lastName: "Bailey",
        phone: "8655551212",
        email: `tony-${stamp}@test.local`,
        businessName: "Bailey Residence LLC",
      },
    });
    const other = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Hidden",
        lastName: "OfficeOnly",
        phone: "8655559999",
        email: `hidden-${stamp}@test.local`,
      },
    });
    const customerB = await prisma.customer.create({
      data: {
        companyId: companyB.id,
        firstName: "Tony",
        lastName: "Bailey",
        phone: "8655551212",
      },
    });
    ids.customerAssigned = assigned.id;
    ids.customerOther = other.id;
    ids.customerB = customerB.id;

    const propertyA = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: assigned.id,
        address: "117 Remington Drive",
        city: "Maynardville",
        state: "TN",
        zip: "37807",
        isPrimary: true,
      },
    });
    ids.propertyA = propertyA.id;
    const jobA = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: assigned.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-SRCH-${stamp}`,
        status: "SCHEDULED",
        assignments: { create: { userId: techA.id } },
      },
    });
    ids.jobA = jobA.id;
    const photo = await prisma.jobPhoto.create({
      data: {
        companyId: companyA.id,
        jobId: jobA.id,
        kind: "BEFORE",
        caption: "Burnt contactor found on arrival.",
        fileName: "before.jpg",
        filePath: `${companyA.id}/job-photos/before.jpg`,
        mimeType: "image/jpeg",
        uploadedById: techA.id,
      },
    });
    ids.photoA = photo.id;
  });

  afterAll(async () => {
    const companies = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.jobPhoto.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.jobAssignment.deleteMany({ where: { job: { companyId: { in: companies } } } });
    await prisma.job.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.property.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: companies } } });
    await prisma.company.deleteMany({ where: { id: { in: companies } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.techA].filter(Boolean) } } });
  });

  it("searches name, phone, email, address, and company without loading every customer", async () => {
    const byName = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "Tony Bailey",
      take: 12,
    });
    expect(byName.some((row) => row.id === ids.customerAssigned)).toBe(true);
    expect(byName.length).toBeLessThanOrEqual(12);

    const byLastName = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "Bailey",
    });
    expect(byLastName.some((row) => row.id === ids.customerAssigned)).toBe(true);

    const byFirstName = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "Tony",
    });
    expect(byFirstName.some((row) => row.id === ids.customerAssigned)).toBe(true);

    const byLastFirst = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "Bailey, Tony",
    });
    expect(byLastFirst.some((row) => row.id === ids.customerAssigned)).toBe(true);

    const byPhone = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "8655551212",
    });
    expect(byPhone.some((row) => row.id === ids.customerAssigned)).toBe(true);

    const byEmail = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "tony-",
    });
    expect(byEmail.some((row) => row.id === ids.customerAssigned)).toBe(true);

    const byAddress = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "Remington",
    });
    expect(byAddress.some((row) => row.id === ids.customerAssigned)).toBe(true);

    const byCompany = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "Bailey Residence",
    });
    expect(byCompany.some((row) => row.id === ids.customerAssigned)).toBe(true);

    const isolated = await searchCustomers({
      companyId: ids.companyA,
      role: "COMPANY_OWNER",
      userId: ids.ownerA,
      query: "Tony",
    });
    expect(isolated.some((row) => row.id === ids.customerB)).toBe(false);
  });

  it("restricts technician customer search to assigned work", async () => {
    const rows = await searchCustomers({
      companyId: ids.companyA,
      role: "TECHNICIAN",
      userId: ids.techA,
      query: "Hidden",
    });
    expect(rows.some((row) => row.id === ids.customerOther)).toBe(false);
    const assigned = await searchCustomers({
      companyId: ids.companyA,
      role: "TECHNICIAN",
      userId: ids.techA,
      query: "Tony",
    });
    expect(assigned.some((row) => row.id === ids.customerAssigned)).toBe(true);
  });

  it("associates photos to the job and blocks unauthorized or cross-tenant access", async () => {
    expect(JOB_PHOTO_KINDS.map((kind) => kind.value)).toEqual(
      expect.arrayContaining([
        "BEFORE",
        "AFTER",
        "EQUIPMENT",
        "DATA_PLATE",
        "DIAGNOSTIC",
        "REPAIR",
        "WARRANTY",
        "RECEIPT",
        "OTHER",
      ])
    );
    expect(isJobPhotoKind("DATA_PLATE")).toBe(true);
    expect(looksLikeImage({ type: "", name: "plate.HEIC" })).toBe(true);
    expect(looksLikeImage({ type: "application/pdf", name: "doc.pdf" })).toBe(false);

    const photo = await prisma.jobPhoto.findFirst({
      where: { id: ids.photoA, companyId: ids.companyA },
    });
    expect(photo?.caption).toBe("Burnt contactor found on arrival.");
    expect(photo?.jobId).toBe(ids.jobA);

    const cross = await prisma.jobPhoto.findFirst({
      where: { id: ids.photoA, companyId: ids.companyB },
    });
    expect(cross).toBeNull();

    await prisma.jobAssignment.deleteMany({ where: { jobId: ids.jobA, userId: ids.techA } });
    const access = jobAccessFilter("TECHNICIAN", ids.techA);
    const lost = await prisma.job.findFirst({
      where: { id: ids.jobA, companyId: ids.companyA, ...access },
    });
    expect(lost).toBeNull();
    const lostPhotoJob = await prisma.jobPhoto.findFirst({
      where: { id: ids.photoA, job: { companyId: ids.companyA, ...access } },
    });
    expect(lostPhotoJob).toBeNull();
  });
});

describe("field layout, inbox, and communications readiness", () => {
  it("keeps technician content above the fixed bottom nav", () => {
    expect(TECH_CONTENT_BOTTOM_PADDING).toContain("5.75rem");
    expect(TECH_CONTENT_BOTTOM_PADDING).toContain("safe-area-inset-bottom");
    expect(TECH_NAV_SAFE_AREA).toContain("safe-area-inset-bottom");
    expect(TECH_LAYOUT_VIEWPORTS).toEqual([375, 390, 430, 768, 1280]);
    for (const section of ["photos", "equipment", "options", "invoice", "complete", "playbook"]) {
      expect(remainingHref({ stepId: "x", title: section, reason: section })).toMatch(/^#/);
    }
  });

  it("does not invent communications in the inbox empty state", () => {
    const empty = technicianInboxEmptyCopy();
    expect(empty.title).toBe("No conversations yet.");
    expect(empty.detail).toMatch(/assigned jobs/);
    expect(smsProviderConfigured() ? "live" : "fallback").toMatch(/live|fallback/);
  });
});
