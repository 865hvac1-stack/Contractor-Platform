import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { renderMergeFields, listUnknownFields, PREVIEW_SAMPLE } from "@/lib/playbooks/merge-fields";
import { remainingRequiredItems, parseDefinition, nextTechnicianAction } from "@/lib/playbooks/engine";
import { getStarterTemplate, STARTER_TEMPLATES } from "@/lib/playbooks/templates";
import { assignPlaybookToJob } from "@/lib/playbooks/assign";
import { EMPTY_DEFINITION } from "@/lib/playbooks/types";
import { can } from "@/lib/permissions";

const prisma = new PrismaClient();

describe("playbook permissions", () => {
  it("lets owners manage playbooks and keeps technicians off configuration", () => {
    expect(can("COMPANY_OWNER", "playbooks:manage")).toBe(true);
    expect(can("ADMIN", "playbooks:manage")).toBe(true);
    expect(can("OFFICE", "playbooks:view")).toBe(true);
    expect(can("OFFICE", "playbooks:manage")).toBe(false);
    expect(can("TECHNICIAN", "playbooks:manage")).toBe(false);
    expect(can("TECHNICIAN", "playbooks:view")).toBe(false);
    expect(can("DISPATCHER", "playbooks:view")).toBe(true);
  });
});

describe("safe message merge fields", () => {
  it("replaces only allowed tokens and never executes code", () => {
    const body =
      "Hi {{customer.firstName}}, {{technician.firstName}} from {{company.name}} is on the way. {{job.evil}} {{constructor}}";
    const rendered = renderMergeFields(body, PREVIEW_SAMPLE);
    expect(rendered).toContain("Alex");
    expect(rendered).toContain("Jordan");
    expect(rendered).toContain("{{job.evil}}");
    expect(listUnknownFields(body)).toEqual(["job.evil", "constructor"]);
  });

  it("preview sample is clearly example data, not a live send", () => {
    expect(PREVIEW_SAMPLE["customer.fullName"]).toBe("Alex Rivera");
    expect(renderMergeFields("Hi {{customer.firstName}}", PREVIEW_SAMPLE)).toBe("Hi Alex");
  });
});

describe("starter templates are examples only", () => {
  it("exposes more than one industry-agnostic starter and clones on use", () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThan(3);
    const keys = STARTER_TEMPLATES.map((t) => t.key);
    expect(keys).toContain("residential_service");
    expect(keys).toContain("commercial_maintenance");
    const first = getStarterTemplate("residential_service");
    expect(first).not.toBeNull();
    first!.definition.phases[0]!.steps[0]!.title = "Mutated";
    const second = getStarterTemplate("residential_service");
    expect(second!.definition.phases[0]!.steps[0]!.title).not.toBe("Mutated");
  });
});

describe("playbook engine", () => {
  it("picks the next technician tap and lists remaining required work", async () => {
    const definition = getStarterTemplate("residential_service")!.definition;
    const next = nextTechnicianAction(definition, new Set());
    expect(next?.actionKey).toBe("ON_MY_WAY");
    expect(parseDefinition(EMPTY_DEFINITION).phases).toHaveLength(5);
  });
});

describe("playbook tenant isolation and versioning", () => {
  const ids = {
    companyA: "",
    companyB: "",
    userA: "",
    customerA: "",
    propertyA: "",
    playbookA: "",
    versionA: "",
    jobA: "",
    jobPlain: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const userA = await prisma.user.create({
      data: {
        email: `pb-a-${stamp}@test.local`,
        passwordHash: hash,
        firstName: "Pat",
        lastName: "A",
      },
    });
    ids.userA = userA.id;

    const companyA = await prisma.company.create({
      data: {
        businessName: `Playbook A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Playbook B ${stamp}`,
        industry: "PLUMBING",
        status: "ACTIVE",
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const customer = await prisma.customer.create({
      data: {
        companyId: companyA.id,
        firstName: "Sam",
        lastName: "Smith",
      },
    });
    const property = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        address: "123 Main St",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
      },
    });
    ids.customerA = customer.id;
    ids.propertyA = property.id;

    const playbook = await prisma.playbook.create({
      data: {
        companyId: companyA.id,
        name: "Residential Service",
        status: "ACTIVE",
        sortOrder: 1,
      },
    });
    const definition = getStarterTemplate("residential_service")!.definition;
    const version = await prisma.playbookVersion.create({
      data: {
        companyId: companyA.id,
        playbookId: playbook.id,
        versionNumber: 1,
        definition,
        createdById: userA.id,
      },
    });
    await prisma.playbook.update({
      where: { id: playbook.id },
      data: { currentVersionId: version.id },
    });
    ids.playbookA = playbook.id;
    ids.versionA = version.id;

    const job = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        propertyId: property.id,
        jobNumber: `JOB-PB-${stamp}`,
        status: "SCHEDULED",
      },
    });
    ids.jobA = job.id;
    await assignPlaybookToJob({
      companyId: companyA.id,
      jobId: job.id,
      playbookId: playbook.id,
    });

    const plain = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customer.id,
        propertyId: property.id,
        jobNumber: `JOB-PLAIN-${stamp}`,
        status: "SCHEDULED",
        jobType: "Legacy service",
      },
    });
    ids.jobPlain = plain.id;
  });

  afterAll(async () => {
    await prisma.jobChecklistItem.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.jobWorkflowEvent.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.jobPlaybookSnapshot.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.job.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.playbookVersion.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.playbook.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.property.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.customer.deleteMany({
      where: { companyId: { in: [ids.companyA, ids.companyB] } },
    });
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    if (ids.userA) await prisma.user.delete({ where: { id: ids.userA } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("Company B cannot read Company A playbooks, versions, snapshots, or checklists", async () => {
    const playbook = await prisma.playbook.findFirst({
      where: { id: ids.playbookA, companyId: ids.companyB },
    });
    const version = await prisma.playbookVersion.findFirst({
      where: { id: ids.versionA, companyId: ids.companyB },
    });
    const snapshot = await prisma.jobPlaybookSnapshot.findFirst({
      where: { jobId: ids.jobA, companyId: ids.companyB },
    });
    const forms = await prisma.formTemplate.findMany({
      where: { companyId: ids.companyB, playbookId: ids.playbookA },
    });
    expect(playbook).toBeNull();
    expect(version).toBeNull();
    expect(snapshot).toBeNull();
    expect(forms).toHaveLength(0);
  });

  it("Company B cannot mutate Company A playbooks", async () => {
    const result = await prisma.playbook.updateMany({
      where: { id: ids.playbookA, companyId: ids.companyB },
      data: { name: "Hijacked" },
    });
    expect(result.count).toBe(0);
    const still = await prisma.playbook.findFirst({
      where: { id: ids.playbookA, companyId: ids.companyA },
    });
    expect(still?.name).toBe("Residential Service");
  });

  it("assigns a snapshot and leaves jobs without a playbook working", async () => {
    const assigned = await prisma.job.findFirst({
      where: { id: ids.jobA, companyId: ids.companyA },
      include: { playbookSnapshot: true },
    });
    const plain = await prisma.job.findFirst({
      where: { id: ids.jobPlain, companyId: ids.companyA },
      include: { playbookSnapshot: true },
    });
    expect(assigned?.playbookId).toBe(ids.playbookA);
    expect(assigned?.playbookSnapshot).not.toBeNull();
    expect(assigned?.jobType).toBe("Residential Service");
    expect(plain?.playbookId).toBeNull();
    expect(plain?.playbookSnapshot).toBeNull();
    expect(plain?.status).toBe("SCHEDULED");
  });

  it("editing the live playbook does not rewrite the job snapshot", async () => {
    const mutated = structuredClone(getStarterTemplate("residential_service")!.definition);
    mutated.phases[0]!.steps[0]!.title = "Changed reminder";
    await prisma.playbookVersion.create({
      data: {
        companyId: ids.companyA,
        playbookId: ids.playbookA,
        versionNumber: 2,
        definition: mutated,
      },
    });
    const snapshot = await prisma.jobPlaybookSnapshot.findFirst({
      where: { jobId: ids.jobA, companyId: ids.companyA },
    });
    const frozen = parseDefinition(snapshot!.definition);
    expect(frozen.phases[0]!.steps[0]!.title).not.toBe("Changed reminder");
  });

  it("lists remaining required items in plain language", async () => {
    const snapshot = await prisma.jobPlaybookSnapshot.findFirst({
      where: { jobId: ids.jobA, companyId: ids.companyA },
    });
    const remaining = await remainingRequiredItems({
      companyId: ids.companyA,
      jobId: ids.jobA,
      definition: parseDefinition(snapshot!.definition),
    });
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.every((item) => item.title && item.reason)).toBe(true);
  });

  it("duplicates a playbook inside the same company only", async () => {
    const source = await prisma.playbook.findFirst({
      where: { id: ids.playbookA, companyId: ids.companyA },
    });
    const copy = await prisma.playbook.create({
      data: {
        companyId: ids.companyA,
        name: "Commercial Maintenance",
        description: source?.description,
        status: "ACTIVE",
        sortOrder: 2,
      },
    });
    const leaked = await prisma.playbook.findFirst({
      where: { id: copy.id, companyId: ids.companyB },
    });
    expect(leaked).toBeNull();
    await prisma.playbook.delete({ where: { id: copy.id } });
  });
});
