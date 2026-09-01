import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { can } from "@/lib/permissions";
import { getStarterTemplate } from "@/lib/playbooks/templates";
import { loadJob360 } from "@/lib/jobs/job-360";
import { publicImportedFields, buildImportedJobSnapshot, importedWorkFields, loadJobImportSupplement } from "@/lib/jobs/imported-history";
import { buildWorkSummary, isGenericJobTypeLabel, stripImportBoilerplate } from "@/lib/jobs/work-summary";
import { customerSearchWhere } from "@/lib/customers/search";
import { buildJobTimeline } from "@/lib/jobs/timeline";
import { JOBS_PAGE_SIZE, jobsWhere, parseJobsListQuery } from "@/lib/jobs/search";
import { assignPlaybookToJob } from "@/lib/playbooks/assign";
import { isHistoricalImport } from "@/lib/imports/safety";

const prisma = new PrismaClient();

describe("imported field safety", () => {
  it("keeps useful leftover fields and hides secrets", () => {
    const fields = publicImportedFields({
      createdDate: "2025-05-14",
      total: "389.00",
      token: "abc",
      companyId: "should-hide",
      description: "shown elsewhere",
    });
    expect(fields.some((field) => field.label === "Created date")).toBe(true);
    expect(fields.some((field) => /token|company/i.test(field.key))).toBe(false);
    expect(buildImportedJobSnapshot({ total: "$389.00", password: "nope" }).password).toBeUndefined();
    expect(buildImportedJobSnapshot({ total: "$389.00" }).total).toBe("$389.00");
  });

  it("puts imported work notes in front and does not invent diagnosis", () => {
    const work = buildWorkSummary({
      jobType: "Service Call",
      description: "Service Call",
      internalNotes:
        "Imported historical record from unknown. ContractorYou did not send messages, start billing, or take a payment.\n\nReplaced dual run capacitor.\n\nHistorical technician: John Smith",
      importNotes: "Replaced dual run capacitor.",
      importFields: [{ key: "Invoice notes", label: "Invoice notes", value: "1x capacitor" }],
    });
    expect(isGenericJobTypeLabel("Service Call")).toBe(true);
    expect(work.jobType).toBe("Service Call");
    expect(work.hasWorkDetail).toBe(true);
    expect(work.blocks.some((block) => /capacitor/i.test(block.text))).toBe(true);
    expect(work.blocks.every((block) => !/Imported historical record/i.test(block.text))).toBe(true);
    expect(work.blocks.some((block) => /diagnosis/i.test(block.label))).toBe(false);
    expect(stripImportBoilerplate("Imported historical record from unknown. ContractorYou did not send messages, start billing, or take a payment.")).toBe("");
    const empty = buildWorkSummary({ jobType: "Service Call", description: "Service Call" });
    expect(empty.hasWorkDetail).toBe(false);
    expect(empty.emptyMessage).toMatch(/did not include notes/i);
    expect(importedWorkFields({ Notes: "Replaced capacitor", token: "nope" }).some((field) => /capacitor/i.test(field.value))).toBe(true);
  });

  it("matches customers by first name, last name, or last-name-first", () => {
    const last = customerSearchWhere("co_1", "Abner") as { OR: Record<string, unknown>[] };
    expect(last.OR.some((clause) => (clause.lastName as { contains?: string })?.contains === "Abner")).toBe(true);
    const first = customerSearchWhere("co_1", "George") as { OR: Record<string, unknown>[] };
    expect(first.OR.some((clause) => (clause.firstName as { contains?: string })?.contains === "George")).toBe(true);
    const reversed = customerSearchWhere("co_1", "Abner, George") as { OR: Record<string, unknown>[] };
    expect(
      reversed.OR.some(
        (clause) =>
          Array.isArray(clause.AND) &&
          (clause.AND[0] as { lastName?: { contains?: string } }).lastName?.contains === "Abner"
      )
    ).toBe(true);
  });

  it("does not invent timeline events", () => {
    const createdAt = new Date("2026-08-31T12:00:00Z");
    const items = buildJobTimeline({
      createdAt,
      historical: true,
      occurredAt: new Date("2025-05-14T00:00:00Z"),
      completedAt: new Date("2025-05-14T18:00:00Z"),
    });
    expect(items.map((item) => item.title)).toEqual([
      "Original job date",
      "Job completed",
      "Imported into ContractorYou",
    ]);
  });

  it("paginates job search server-side", () => {
    expect(JOBS_PAGE_SIZE).toBe(40);
    expect(parseJobsListQuery({ page: "2", q: "knox" }).page).toBe(2);
    const where = jobsWhere({ companyId: "co_1", access: {}, q: "34645915", status: "COMPLETED" });
    expect(where.companyId).toBe("co_1");
    expect(where.status).toBe("COMPLETED");
    expect(Array.isArray(where.OR)).toBe(true);
  });
});

describe("Job 360 records", () => {
  const ids = {
    companyA: "",
    companyB: "",
    ownerA: "",
    techA: "",
    customerA: "",
    propertyA: "",
    importedJob: "",
    nativeJob: "",
    relatedJob: "",
    jobB: "",
    invoiceA: "",
    paymentA: "",
    playbook: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const ownerA = await prisma.user.create({
      data: { email: `j360-owner-${stamp}@test.local`, passwordHash: hash, firstName: "TJ", lastName: "Owner" },
    });
    const techA = await prisma.user.create({
      data: { email: `j360-tech-${stamp}@test.local`, passwordHash: hash, firstName: "Field", lastName: "Tech" },
    });
    ids.ownerA = ownerA.id;
    ids.techA = techA.id;
    const companyA = await prisma.company.create({
      data: {
        businessName: `360 A ${stamp}`,
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
      data: { businessName: `360 B ${stamp}`, industry: "PLUMBING", status: "ACTIVE" },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "George", lastName: "Abner", phone: "8655550100", status: "ACTIVE" },
    });
    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Other", lastName: "Co", status: "ACTIVE" },
    });
    ids.customerA = customerA.id;
    const propertyA = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        address: "123 Main Street",
        city: "Knoxville",
        state: "TN",
        zip: "37914",
        isPrimary: true,
      },
    });
    const propertyB = await prisma.property.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        address: "9 Other",
        city: "Nashville",
        state: "TN",
        zip: "37201",
      },
    });
    ids.propertyA = propertyA.id;
    const imported = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-IMP-${stamp}`,
        status: "COMPLETED",
        description: "Service Call — upstairs not cooling",
        internalNotes:
          "Imported historical record from unknown. ContractorYou did not send messages, start billing, or take a payment.\n\nReplaced dual run capacitor. System cooling again.\n\nHistorical technician: John Smith",
        importMode: "HISTORICAL",
        sourceSystem: "UNKNOWN",
        externalId: "34645915",
        importedTechnicianName: "John Smith",
        importedOccurredAt: new Date("2025-05-14T09:00:00Z"),
        importedTotalCents: 38900,
        importedSnapshot: { createdDate: "2025-05-14", total: "$389.00" },
        completedAt: new Date("2025-05-14T18:00:00Z"),
      },
    });
    ids.importedJob = imported.id;
    await prisma.importSession.create({
      data: {
        id: `sess-360-${stamp}`,
        companyId: companyA.id,
        userId: ownerA.id,
        recordType: "JOBS",
        sourceType: "UNKNOWN",
        fileName: "jobs.csv",
        fileHash: `360-${stamp}`,
        status: "COMPLETED",
        rowCount: 1,
        importMode: "HISTORICAL",
      },
    });
    await prisma.job.update({
      where: { id: imported.id },
      data: { importSessionId: `sess-360-${stamp}` },
    });
    await prisma.importRow.create({
      data: {
        companyId: companyA.id,
        importSessionId: `sess-360-${stamp}`,
        rowNumber: 1,
        status: "IMPORTED",
        targetRecordId: imported.id,
        rawData: {
          "Job amount": "$389.00",
          "Job created date": "2025-05-14",
          "Job Type": "Service Call",
          Notes: "Replaced dual run capacitor. System cooling again.",
          "Invoice notes": "1x dual run capacitor",
        },
        mappedData: {
          values: {
            description: "Service Call — upstairs not cooling",
            notes: "Replaced dual run capacitor. System cooling again.",
            total: "$389.00",
            createdDate: "2025-05-14",
          },
        },
      },
    });
    const native = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-LIVE-${stamp}`,
        status: "SCHEDULED",
        description: "New ContractorYou job",
        importMode: "LIVE",
        scheduledStart: new Date("2026-09-02T14:00:00Z"),
        assignments: { create: { userId: techA.id } },
      },
    });
    ids.nativeJob = native.id;
    const related = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `JOB-REL-${stamp}`,
        status: "COMPLETED",
        jobType: "Routine Maintenance",
        importMode: "HISTORICAL",
        completedAt: new Date("2024-10-02T15:00:00Z"),
      },
    });
    ids.relatedJob = related.id;
    const jobB = await prisma.job.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        propertyId: propertyB.id,
        jobNumber: `JOB-B-${stamp}`,
        status: "NEW",
      },
    });
    ids.jobB = jobB.id;
    const invoice = await prisma.invoice.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        jobId: imported.id,
        invoiceNumber: `INV-360-${stamp}`,
        status: "PAID",
        totalCents: 38900,
        amountPaidCents: 38900,
        balanceCents: 0,
        importMode: "HISTORICAL",
        lineItems: { create: [{ name: "Capacitor Replacement", quantity: 1, unitPriceCents: 38900 }] },
      },
    });
    ids.invoiceA = invoice.id;
    const payment = await prisma.payment.create({
      data: {
        companyId: companyA.id,
        invoiceId: invoice.id,
        amountCents: 38900,
        method: "CHECK",
        status: "RECORDED",
        importMode: "HISTORICAL",
      },
    });
    ids.paymentA = payment.id;
    const playbook = await prisma.playbook.create({
      data: { companyId: companyA.id, name: "Service", status: "ACTIVE", sortOrder: 1 },
    });
    const version = await prisma.playbookVersion.create({
      data: {
        companyId: companyA.id,
        playbookId: playbook.id,
        versionNumber: 1,
        definition: getStarterTemplate("residential_service")!.definition,
        createdById: ownerA.id,
      },
    });
    await prisma.playbook.update({ where: { id: playbook.id }, data: { currentVersionId: version.id } });
    ids.playbook = playbook.id;
  });

  afterAll(async () => {
    const companyIds = [ids.companyA, ids.companyB].filter(Boolean);
    await prisma.payment.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.invoice.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.importRow.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.playbookVersion.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.playbook.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.importSession.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.property.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.ownerA, ids.techA] } } });
    await prisma.$disconnect();
  });

  it("opens an imported job with customer, property, description, and notes", async () => {
    const view = await loadJob360(prisma, {
      companyId: ids.companyA,
      jobId: ids.importedJob,
      role: "COMPANY_OWNER",
      access: {},
    });
    expect(view?.customer.name).toBe("George Abner");
    expect(view?.property.address).toBe("123 Main Street");
    expect(view?.job.description).toMatch(/upstairs not cooling/i);
    expect(view?.job.internalNotes).toMatch(/Historical technician/i);
    expect(view?.import.historical).toBe(true);
    expect(view?.technicians.importedName).toBe("John Smith");
    expect(view?.import.totalCents).toBe(38900);
    expect(view?.import.fields.some((field) => field.value.includes("389"))).toBe(true);
    expect(view?.work.blocks.some((block) => /capacitor/i.test(block.text))).toBe(true);
    expect(view?.work.blocks.every((block) => !/Imported historical record/i.test(block.text))).toBe(true);
  });

  it("opens a native job without treating it as historical", async () => {
    const view = await loadJob360(prisma, {
      companyId: ids.companyA,
      jobId: ids.nativeJob,
      role: "COMPANY_OWNER",
      access: {},
    });
    expect(view?.job.historical).toBe(false);
    expect(view?.job.description).toBe("New ContractorYou job");
    expect(view?.technicians.assigned[0]?.name).toMatch(/Field Tech/);
    expect(isHistoricalImport(view?.job.importMode)).toBe(false);
  });

  it("does not double-count imported financials against invoice totals", async () => {
    const view = await loadJob360(prisma, {
      companyId: ids.companyA,
      jobId: ids.importedJob,
      role: "COMPANY_OWNER",
      access: {},
    });
    expect(view?.financials.invoiceCents).toBe(38900);
    expect(view?.financials.paidCents).toBe(38900);
    expect(view?.financials.importedTotalCents).toBe(38900);
    expect(view?.lines[0]?.name).toBe("Capacitor Replacement");
  });

  it("loads other jobs at the same property", async () => {
    const view = await loadJob360(prisma, {
      companyId: ids.companyA,
      jobId: ids.importedJob,
      role: "COMPANY_OWNER",
      access: {},
    });
    expect(view?.relatedJobs.some((job) => job.id === ids.relatedJob)).toBe(true);
    expect(view?.relatedJobs.some((job) => job.id === ids.jobB)).toBe(false);
  });

  it("tolerates missing historical fields", async () => {
    const supplement = await loadJobImportSupplement(prisma, {
      companyId: ids.companyA,
      jobId: "missing",
      importMode: "HISTORICAL",
      createdAt: new Date(),
    });
    expect(supplement.description).toBeNull();
    expect(supplement.fields).toEqual([]);
    expect(supplement.workFields).toEqual([]);
  });

  it("does not assign a playbook to an imported historical job", async () => {
    const assigned = await assignPlaybookToJob({
      companyId: ids.companyA,
      jobId: ids.importedJob,
      playbookId: ids.playbook,
    });
    expect(assigned).toBeNull();
    const job = await prisma.job.findFirst({ where: { id: ids.importedJob } });
    expect(job?.playbookId).toBeNull();
  });

  it("Company A cannot load Company B job", async () => {
    const leaked = await loadJob360(prisma, {
      companyId: ids.companyA,
      jobId: ids.jobB,
      role: "COMPANY_OWNER",
      access: {},
    });
    expect(leaked).toBeNull();
  });

  it("technicians only see assigned jobs", async () => {
    const assignedFilter = { assignments: { some: { userId: ids.techA } } };
    const native = await loadJob360(prisma, {
      companyId: ids.companyA,
      jobId: ids.nativeJob,
      role: "TECHNICIAN",
      access: assignedFilter,
    });
    const imported = await loadJob360(prisma, {
      companyId: ids.companyA,
      jobId: ids.importedJob,
      role: "TECHNICIAN",
      access: assignedFilter,
    });
    expect(native?.job.id).toBe(ids.nativeJob);
    expect(imported).toBeNull();
    expect(can("TECHNICIAN", "job_costs:view")).toBe(false);
  });
});
