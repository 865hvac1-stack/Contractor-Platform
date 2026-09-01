import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type JobStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addHours, startOfDay, subDays } from "date-fns";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { invokeRegisteredAction } from "@/lib/actions/invoke";
import { planFromQuestion } from "@/lib/actions/planner";
import { buildIssues, buildMetrics, getDispatchBoard, toDispatchCard } from "@/lib/dispatch/board";
import { countActiveDispatchFilters, matchesDispatchFilters } from "@/lib/dispatch/filters";
import { classifyDispatchJob } from "@/lib/dispatch/job-type";
import { findScheduleConflict, isRunningLate, minutesLate, technicianBoardState } from "@/lib/dispatch/validate";
import { suggestedQuestions } from "@/lib/intelligence/intent";
import { can } from "@/lib/permissions";
import { routingConfigured } from "@/lib/routing/provider";
import type { ActionContext } from "@/lib/actions/types";

const prisma = new PrismaClient();

function card(partial: Partial<ReturnType<typeof toDispatchCard>> & { id: string }) {
  return {
    customerId: "c1",
    jobNumber: "J-1",
    jobType: "Maintenance",
    kind: "maintenance" as const,
    trade: "HVAC",
    status: "SCHEDULED" as JobStatus,
    statusLabel: "Scheduled",
    priority: "NORMAL",
    description: null,
    scheduledStart: null as Date | null,
    scheduledEnd: null as Date | null,
    scheduleLocked: false,
    routeOrder: null,
    customer: "Patricia Holloway",
    phone: "8655550100",
    email: null,
    address: "1 Main, Knoxville, TN 37914",
    city: "Knoxville",
    accessNotes: null,
    membership: "Summit Comfort Club",
    assigneeIds: [] as string[],
    assignees: [] as string[],
    ...partial,
  };
}

describe("dispatch V2 helpers", () => {
  it("classifies job types without a rainbow of invented categories", () => {
    expect(classifyDispatchJob({ jobType: "No Cooling", priority: "URGENT" })).toBe("emergency");
    expect(classifyDispatchJob({ jobType: "Maintenance" })).toBe("maintenance");
    expect(classifyDispatchJob({ jobType: "System Replacement" })).toBe("install");
    expect(classifyDispatchJob({ description: "Follow-up after Saturday call" })).toBe("callback");
    expect(classifyDispatchJob({ jobType: "Leak Repair" })).toBe("service");
  });

  it("detects running late only for scheduled or dispatched work that already started", () => {
    const now = new Date("2026-09-01T15:00:00");
    expect(isRunningLate({ scheduledStart: "2026-09-01T14:00:00", status: "SCHEDULED" }, now)).toBe(true);
    expect(isRunningLate({ scheduledStart: "2026-09-01T14:00:00", status: "IN_PROGRESS" }, now)).toBe(false);
    expect(isRunningLate({ scheduledStart: "2026-09-01T16:00:00", status: "SCHEDULED" }, now)).toBe(false);
    expect(minutesLate({ scheduledStart: "2026-09-01T14:00:00", status: "SCHEDULED" }, now)).toBe(60);
  });

  it("derives technician board state from real job statuses", () => {
    expect(technicianBoardState([{ status: "IN_PROGRESS" }])).toBe("ON_JOB");
    expect(technicianBoardState([{ status: "DISPATCHED" }])).toBe("EN_ROUTE");
    expect(technicianBoardState([{ status: "COMPLETED" }])).toBe("DONE_FOR_DAY");
    expect(technicianBoardState([{ status: "SCHEDULED" }])).toBe("AVAILABLE");
  });

  it("finds overlapping schedule conflicts and ignores completed work", () => {
    const existing = [
      { id: "a", scheduledStart: "2026-09-01T14:00:00", scheduledEnd: "2026-09-01T15:30:00", status: "SCHEDULED" },
      { id: "b", scheduledStart: "2026-09-01T09:00:00", scheduledEnd: "2026-09-01T10:00:00", status: "COMPLETED" },
    ];
    expect(
      findScheduleConflict(existing, {
        id: "c",
        scheduledStart: "2026-09-01T14:30:00",
        scheduledEnd: "2026-09-01T16:00:00",
        status: "SCHEDULED",
      })?.id
    ).toBe("a");
    expect(
      findScheduleConflict(existing, {
        id: "c",
        scheduledStart: "2026-09-01T09:15:00",
        scheduledEnd: "2026-09-01T09:45:00",
        status: "SCHEDULED",
      })
    ).toBeNull();
  });

  it("filters pulse, search, type, status, and service area against real card fields", () => {
    const jobs = [
      card({ id: "1", status: "COMPLETED", city: "Knoxville", customer: "Patricia Holloway" }),
      card({ id: "2", status: "IN_PROGRESS", city: "Farragut", customer: "John Smith", jobType: "No Cooling", kind: "emergency", priority: "URGENT" }),
      card({
        id: "3",
        status: "SCHEDULED",
        scheduledStart: new Date("2026-09-01T10:00:00"),
        city: "Knoxville",
        customer: "Owen Hodge",
        assigneeIds: [],
      }),
    ];
    expect(jobs.filter((job) => matchesDispatchFilters(job, { query: "patricia", jobType: "all", status: "all", city: "all", pulse: "all" }))).toHaveLength(1);
    expect(jobs.filter((job) => matchesDispatchFilters(job, { query: "", jobType: "all", status: "all", city: "Farragut", pulse: "all" }))).toHaveLength(1);
    expect(jobs.filter((job) => matchesDispatchFilters(job, { query: "", jobType: "all", status: "all", city: "all", pulse: "emergency" }))).toHaveLength(1);
    expect(
      jobs.filter((job) =>
        matchesDispatchFilters(job, { query: "", jobType: "all", status: "all", city: "all", pulse: "runningLate" }, new Date("2026-09-01T12:00:00"))
      )
    ).toHaveLength(1);
    expect(countActiveDispatchFilters({ techId: "all", jobType: "all", status: "all", city: "all" })).toBe(0);
    expect(countActiveDispatchFilters({ techId: "t1", jobType: "Maintenance", status: "all", city: "all", priority: "URGENT" })).toBe(3);
  });

  it("builds today metrics and categorized issues from the same cards", () => {
    const cards = [
      card({ id: "late", status: "SCHEDULED", scheduledStart: new Date("2026-09-01T10:00:00"), assignees: ["Marcus Reed"], assigneeIds: ["m"] }),
      card({ id: "open", status: "SCHEDULED", priority: "URGENT", kind: "emergency", jobType: "No Cooling" }),
      card({ id: "done", status: "COMPLETED", assigneeIds: ["c"] }),
    ];
    const metrics = buildMetrics(cards);
    expect(metrics.jobs).toBe(3);
    expect(metrics.completed).toBe(1);
    expect(metrics.unassigned).toBe(1);
    expect(metrics.emergency).toBe(1);
    const issues = buildIssues(cards, [{ userId: "m", name: "Marcus Reed", jobs: [cards[0]!] }]);
    expect(issues.some((issue) => issue.kind === "emergency")).toBe(true);
    expect(issues.some((issue) => issue.jobId === "open" || issue.jobId === "late")).toBe(true);
  });

  it("keeps dispatch Ask suggestions operational", () => {
    const questions = suggestedQuestions("DISPATCHER", null, "dispatch");
    expect(questions.some((item) => /running late/i.test(item))).toBe(true);
    expect(questions.some((item) => /unassigned/i.test(item))).toBe(true);
  });

  it("plans assignment proposals for no-cooling and unassigned questions, defaulting to today", () => {
    const plan = planFromQuestion("Who should take the next no-cooling call?");
    expect(plan.handled).toBe(true);
    expect(plan.steps[0]?.key).toBe("job.propose_assignment");
    expect(plan.steps[0]?.input.when).toBe("today");
  });

  it("does not let technicians receive dispatcher powers just because Dispatch V2 exists", () => {
    expect(can("TECHNICIAN", "schedule:manage")).toBe(false);
    expect(can("TECHNICIAN", "jobs:lock")).toBe(false);
    expect(can("DISPATCHER", "schedule:manage")).toBe(true);
    expect(can("DISPATCHER", "jobs:manage")).toBe(true);
  });

  it("exposes route optimization as a configuration check, not invented savings", () => {
    expect(typeof routingConfigured()).toBe("boolean");
  });

  it("keeps Summit seed and 865 HVAC isolated in source", () => {
    const seed = readFileSync(resolve("src/lib/demo/seed-summit.ts"), "utf8");
    expect(seed).toContain("SUMMIT_COMPANY_NAME");
    expect(seed).toContain("assertResettableDemoCompany");
    expect(seed).not.toMatch(/865 HVAC/);
    const page = readFileSync(resolve("src/app/(app)/dispatch/page.tsx"), "utf8");
    expect(page).toContain("Today&apos;s Dispatch");
    const board = readFileSync(resolve("src/components/dispatch/board.tsx"), "utf8");
    expect(board).toContain("md:hidden");
    expect(board).toContain("hidden min-h-[28rem] flex-1 md:block");
    expect(board).toContain("w-[300px]");
    expect(board).toContain("Filters");
    expect(board).toContain("hidden flex-wrap items-center gap-2 md:flex");
    const card = readFileSync(resolve("src/components/dispatch/job-card.tsx"), "utf8");
    expect(card).toContain('role="button"');
    expect(card).toContain("Open job");
    expect(card).not.toMatch(/<button[\s\S]*draggable/);
    const drawer = readFileSync(resolve("src/components/dispatch/job-drawer.tsx"), "utf8");
    expect(drawer).toContain("Open Job 360");
    expect(drawer).toContain("sticky bottom-0");
    const shell = readFileSync(resolve("src/components/app-shell.tsx"), "utf8");
    expect(shell).toContain("overflow-hidden");
    expect(shell).toContain("AppNav");
    expect(shell).toContain("WorkspaceSwitcher");
    expect(shell).toContain("shrink-0");
    expect(shell).not.toContain("MobileWorkspaceLinks");
    const switcher = readFileSync(resolve("src/components/workspace-switcher.tsx"), "utf8");
    expect(switcher).toContain("hidden min-w-0 md:flex");
    expect(switcher).not.toContain("flex-wrap");
  });
});

describe("dispatch V2 board query", () => {
  const ids = {
    companyA: "",
    companyB: "",
    techA: "",
    techB: "",
    customerA: "",
    customerB: "",
    propertyA: "",
    propertyB: "",
    morning: "",
    afternoon: "",
    unassigned: "",
    otherDay: "",
    otherTenant: "",
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const hash = await bcrypt.hash("DispatchV2-123!", 10);
    const ownerA = await prisma.user.create({
      data: { email: `dv2-owner-${stamp}@test.local`, passwordHash: hash, firstName: "Emily", lastName: "Carter" },
    });
    const techA = await prisma.user.create({
      data: { email: `dv2-tech-${stamp}@test.local`, passwordHash: hash, firstName: "Chris", lastName: "Walker" },
    });
    const techB = await prisma.user.create({
      data: { email: `dv2-techb-${stamp}@test.local`, passwordHash: hash, firstName: "Other", lastName: "Tech" },
    });
    ids.techA = techA.id;
    ids.techB = techB.id;
    const companyA = await prisma.company.create({
      data: {
        businessName: `Dispatch V2 A ${stamp}`,
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
      data: {
        businessName: `Dispatch V2 B ${stamp}`,
        industry: "PLUMBING",
        status: "ACTIVE",
        memberships: { create: { userId: techB.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() } },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;
    const customerA = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Samuel", lastName: "Hensley", phone: "8655550199", status: "ACTIVE" },
    });
    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Leaked", lastName: "Tenant", status: "ACTIVE" },
    });
    ids.customerA = customerA.id;
    ids.customerB = customerB.id;
    const propertyA = await prisma.property.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        address: "200 Dispatch Way",
        city: "Knoxville",
        state: "TN",
        zip: "37919",
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
    ids.propertyB = propertyB.id;
    const day = startOfDay(new Date());
    const morning = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `DV2-M-${stamp}`,
        jobType: "Maintenance",
        status: "COMPLETED",
        scheduledStart: addHours(day, 8),
        scheduledEnd: addHours(day, 9.5),
      },
    });
    const afternoon = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `DV2-A-${stamp}`,
        jobType: "AC Repair",
        status: "SCHEDULED",
        scheduledStart: addHours(day, 14),
        scheduledEnd: addHours(day, 15.5),
        scheduleLocked: true,
      },
    });
    const unassigned = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `DV2-U-${stamp}`,
        jobType: "No Cooling",
        status: "SCHEDULED",
        priority: "URGENT",
        scheduledStart: addHours(day, 13),
        scheduledEnd: addHours(day, 14.5),
      },
    });
    const otherDay = await prisma.job.create({
      data: {
        companyId: companyA.id,
        customerId: customerA.id,
        propertyId: propertyA.id,
        jobNumber: `DV2-O-${stamp}`,
        jobType: "Maintenance",
        status: "SCHEDULED",
        scheduledStart: addHours(subDays(day, 1), 10),
      },
    });
    const otherTenant = await prisma.job.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        propertyId: propertyB.id,
        jobNumber: `DV2-B-${stamp}`,
        jobType: "Leak Repair",
        status: "SCHEDULED",
        scheduledStart: addHours(day, 11),
      },
    });
    await prisma.jobAssignment.create({ data: { jobId: morning.id, userId: techA.id } });
    await prisma.jobAssignment.create({ data: { jobId: afternoon.id, userId: techA.id } });
    await prisma.jobAssignment.create({ data: { jobId: otherDay.id, userId: techA.id } });
    await prisma.jobAssignment.create({ data: { jobId: otherTenant.id, userId: techB.id } });
    ids.morning = morning.id;
    ids.afternoon = afternoon.id;
    ids.unassigned = unassigned.id;
    ids.otherDay = otherDay.id;
    ids.otherTenant = otherTenant.id;
  });

  afterAll(async () => {
    await prisma.jobAssignment.deleteMany({ where: { jobId: { in: [ids.morning, ids.afternoon, ids.otherDay, ids.otherTenant] } } });
    await prisma.job.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.property.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.membership.deleteMany({ where: { companyId: { in: [ids.companyA, ids.companyB] } } });
    await prisma.company.deleteMany({ where: { id: { in: [ids.companyA, ids.companyB] } } });
    await prisma.$disconnect();
  });

  it("loads only the selected date, keeps unassigned in the first lane, and orders jobs by time", async () => {
    const board = await getDispatchBoard(ids.companyA, new Date());
    const idsOnBoard = [...board.unassigned, ...board.technicians.flatMap((lane) => lane.jobs)].map((job) => job.id);
    expect(idsOnBoard).toContain(ids.morning);
    expect(idsOnBoard).toContain(ids.afternoon);
    expect(idsOnBoard).toContain(ids.unassigned);
    expect(idsOnBoard).not.toContain(ids.otherDay);
    expect(idsOnBoard).not.toContain(ids.otherTenant);
    expect(board.unassigned.map((job) => job.id)).toContain(ids.unassigned);
    expect(board.technicians).toHaveLength(1);
    expect(board.technicians[0]?.name).toBe("Chris Walker");
    expect(board.technicians[0]?.jobs.map((job) => job.id)).toEqual([ids.morning, ids.afternoon]);
    expect(board.technicians[0]?.jobs[1]?.scheduleLocked).toBe(true);
    expect(board.metrics.jobs).toBe(3);
    expect(board.metrics.completed).toBe(1);
    expect(board.metrics.unassigned).toBe(1);
    expect(board.metrics.emergency).toBe(1);
    expect(board.issues.some((issue) => issue.kind === "emergency" && issue.jobId === ids.unassigned)).toBe(true);
  });

  it("does not leak the other tenant when loading company B", async () => {
    const board = await getDispatchBoard(ids.companyB, new Date());
    const idsOnBoard = [...board.unassigned, ...board.technicians.flatMap((lane) => lane.jobs)].map((job) => job.id);
    expect(idsOnBoard).toEqual([ids.otherTenant]);
    expect(idsOnBoard).not.toContain(ids.unassigned);
  });

  it("proposes assignment without moving the job, and refuses silent execute", async () => {
    const ctx: ActionContext = {
      companyId: ids.companyA,
      userId: ids.techA,
      role: "COMPANY_OWNER",
      source: "planner",
      companyName: "Dispatch V2 A",
      isDemo: false,
    };
    const proposed = await invokeRegisteredAction({
      ctx,
      actionKey: "job.propose_assignment",
      rawInput: { when: "today" },
    });
    expect(proposed.ok).toBe(true);
    if (proposed.ok) {
      expect(proposed.actionRequest?.status).toBe("AWAITING_APPROVAL");
      expect(proposed.kind).not.toBe("EXECUTED");
    }
    const stillOpen = await prisma.jobAssignment.findMany({ where: { jobId: ids.unassigned } });
    expect(stillOpen).toEqual([]);
    const silent = await invokeRegisteredAction({
      ctx: { ...ctx, source: "model" },
      actionKey: "job.assign",
      rawInput: {},
    });
    expect(silent.ok).toBe(false);
    if (!silent.ok) expect(silent.error.toLowerCase()).toContain("approval");
  });
});
