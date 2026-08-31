import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  applyTechnicianRoute,
  enforceWindows,
  jobIsImmovable,
  mergeFixedOrder,
  previewTechnicianRoute,
  windowViolated,
  type OptimizeJob,
} from "@/lib/routing/optimize";
import { RoutingNotConfiguredError, type RoutingProvider } from "@/lib/routing/provider";
import { runIntelligenceTool } from "@/lib/intelligence/tools";

const prisma = new PrismaClient();

function job(partial: Partial<OptimizeJob> & { id: string }): OptimizeJob {
  return {
    status: "SCHEDULED",
    scheduleLocked: false,
    scheduledStart: null,
    scheduledEnd: null,
    arrivalWindowStart: null,
    arrivalWindowEnd: null,
    address: "1 Main St",
    priority: "NORMAL",
    ...partial,
  };
}

function mockProvider(order: string[]): RoutingProvider {
  return {
    name: "mock",
    configured: () => true,
    async optimize(input) {
      const orderedIds = order.length ? order : input.stops.map((stop) => stop.id);
      return {
        provider: "mock",
        orderedIds,
        durationSeconds: 3600,
        distanceMeters: 16093,
        legs: [],
        polyline: null,
        mapUrl: "https://www.google.com/maps/dir/example",
      };
    },
  };
}

describe("route constraint helpers", () => {
  it("does not treat scheduled work as immovable unless locked or in progress", () => {
    expect(jobIsImmovable(job({ id: "a", status: "SCHEDULED" }))).toBe(false);
    expect(jobIsImmovable(job({ id: "b", status: "COMPLETED" }))).toBe(true);
    expect(jobIsImmovable(job({ id: "c", status: "IN_PROGRESS" }))).toBe(true);
    expect(jobIsImmovable(job({ id: "d", scheduleLocked: true }))).toBe(true);
  });

  it("keeps locked and completed jobs in place when merging a suggested order", () => {
    const jobs = [
      job({ id: "1", scheduleLocked: true }),
      job({ id: "2" }),
      job({ id: "3" }),
      job({ id: "4", status: "COMPLETED" }),
    ];
    expect(mergeFixedOrder(jobs, ["3", "2"])).toEqual(["1", "3", "2", "4"]);
  });

  it("does not move a hard appointment window just to save miles", () => {
    const start = new Date("2026-08-31T10:00:00Z");
    const jobs = [
      job({
        id: "smith",
        scheduledStart: start,
        arrivalWindowStart: new Date("2026-08-31T08:00:00Z"),
        arrivalWindowEnd: new Date("2026-08-31T10:00:00Z"),
      }),
      job({ id: "brown", scheduledStart: new Date("2026-08-31T13:00:00Z") }),
    ];
    expect(enforceWindows(jobs, ["brown", "smith"])).toEqual(["smith", "brown"]);
    expect(windowViolated(jobs[0], new Date("2026-08-31T15:00:00Z"))).toBe(true);
  });
});

describe("route optimization with a real provider abstraction", () => {
  const ids = {
    companyA: "",
    companyB: "",
    techA: "",
    techB: "",
    jobs: [] as string[],
    otherJob: "",
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash("TestPassword-123!", 10);
    const stamp = Date.now();
    const owner = await prisma.user.create({
      data: { email: `route-owner-${stamp}@test.local`, passwordHash: hash, firstName: "Owner", lastName: "A" },
    });
    const techA = await prisma.user.create({
      data: { email: `route-tech-${stamp}@test.local`, passwordHash: hash, firstName: "JR", lastName: "A" },
    });
    const techB = await prisma.user.create({
      data: { email: `route-tech-b-${stamp}@test.local`, passwordHash: hash, firstName: "Other", lastName: "B" },
    });
    ids.techA = techA.id;
    ids.techB = techB.id;

    const companyA = await prisma.company.create({
      data: {
        businessName: `Route A ${stamp}`,
        industry: "HVAC",
        status: "ACTIVE",
        address: "100 Depot St",
        city: "Knoxville",
        state: "TN",
        zip: "37902",
        memberships: {
          create: [
            { userId: owner.id, role: "COMPANY_OWNER", status: "ACTIVE", joinedAt: new Date() },
            { userId: techA.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() },
          ],
        },
      },
    });
    const companyB = await prisma.company.create({
      data: {
        businessName: `Route B ${stamp}`,
        industry: "PLUMBING",
        status: "ACTIVE",
        memberships: {
          create: { userId: techB.id, role: "TECHNICIAN", status: "ACTIVE", joinedAt: new Date() },
        },
      },
    });
    ids.companyA = companyA.id;
    ids.companyB = companyB.id;

    const customer = await prisma.customer.create({
      data: { companyId: companyA.id, firstName: "Pat", lastName: "Customer" },
    });
    const addresses = [
      "10 First St",
      "20 Second St",
      "30 Third St",
      "40 Fourth St",
      "50 Fifth St",
      "60 Sixth St",
    ];
    const day = new Date();
    day.setHours(8, 0, 0, 0);
    for (let i = 0; i < addresses.length; i += 1) {
      const property = await prisma.property.create({
        data: {
          companyId: companyA.id,
          customerId: customer.id,
          address: addresses[i],
          city: "Knoxville",
          state: "TN",
          zip: "37902",
        },
      });
      const jobRow = await prisma.job.create({
        data: {
          companyId: companyA.id,
          customerId: customer.id,
          propertyId: property.id,
          jobNumber: `RT-${stamp}-${i + 1}`,
          status: i === 5 ? "COMPLETED" : "SCHEDULED",
          priority: i === 0 ? "HIGH" : "NORMAL",
          scheduledStart: new Date(day.getTime() + i * 90 * 60 * 1000),
          scheduledEnd: new Date(day.getTime() + i * 90 * 60 * 1000 + 60 * 60 * 1000),
          scheduleLocked: i === 0,
          assignments: { create: { userId: techA.id } },
        },
      });
      ids.jobs.push(jobRow.id);
    }

    const customerB = await prisma.customer.create({
      data: { companyId: companyB.id, firstName: "Other", lastName: "Co" },
    });
    const propertyB = await prisma.property.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        address: "9 Other St",
        city: "Nashville",
        state: "TN",
        zip: "37201",
      },
    });
    const otherJob = await prisma.job.create({
      data: {
        companyId: companyB.id,
        customerId: customerB.id,
        propertyId: propertyB.id,
        jobNumber: `RTB-${stamp}`,
        status: "SCHEDULED",
        assignments: { create: { userId: techB.id } },
      },
    });
    ids.otherJob = otherJob.id;
  });

  afterAll(async () => {
    if (ids.companyA) await prisma.company.delete({ where: { id: ids.companyA } }).catch(() => undefined);
    if (ids.companyB) await prisma.company.delete({ where: { id: ids.companyB } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("returns nothing-to-optimize when only locked or completed jobs remain", async () => {
    const preview = await previewTechnicianRoute(prisma, {
      companyId: ids.companyA,
      technicianUserId: ids.techA,
      day: new Date(),
      provider: mockProvider([]),
    });
    expect(preview.fixedJobIds).toContain(ids.jobs[0]);
    expect(preview.fixedJobIds).toContain(ids.jobs[5]);
    expect(preview.reason === "ok" || preview.reason === "nothing_to_optimize").toBe(true);
  });

  it("does not apply a route that includes another company's job", async () => {
    await expect(
      applyTechnicianRoute(prisma, {
        companyId: ids.companyA,
        technicianUserId: ids.techA,
        orderedIds: [ids.jobs[1], ids.otherJob],
        day: new Date(),
      })
    ).rejects.toThrow(/not in this company/);
  });

  it("does not move a locked or completed job when applying a route", async () => {
    const lockedBefore = await prisma.job.findUnique({ where: { id: ids.jobs[0] } });
    const completedBefore = await prisma.job.findUnique({ where: { id: ids.jobs[5] } });
    await applyTechnicianRoute(prisma, {
      companyId: ids.companyA,
      technicianUserId: ids.techA,
      orderedIds: [ids.jobs[2], ids.jobs[1], ids.jobs[3], ids.jobs[4], ids.jobs[0], ids.jobs[5]],
      day: new Date(),
    });
    const lockedAfter = await prisma.job.findUnique({ where: { id: ids.jobs[0] } });
    const completedAfter = await prisma.job.findUnique({ where: { id: ids.jobs[5] } });
    expect(lockedAfter?.scheduledStart?.toISOString()).toBe(lockedBefore?.scheduledStart?.toISOString());
    expect(completedAfter?.scheduledStart?.toISOString()).toBe(completedBefore?.scheduledStart?.toISOString());
    const moved = await prisma.job.findUnique({ where: { id: ids.jobs[2] } });
    expect(moved?.routeOrder).toBe(1);
  });

  it("throws a not-configured error when no provider credentials exist", async () => {
    const previous = process.env.GOOGLE_MAPS_API_KEY;
    const previousAlt = process.env.GOOGLE_ROUTES_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_ROUTES_API_KEY;
    await expect(
      previewTechnicianRoute(prisma, {
        companyId: ids.companyA,
        technicianUserId: ids.techA,
        day: new Date(),
      })
    ).rejects.toBeInstanceOf(RoutingNotConfiguredError);
    if (previous) process.env.GOOGLE_MAPS_API_KEY = previous;
    if (previousAlt) process.env.GOOGLE_ROUTES_API_KEY = previousAlt;
  });

  it("does not expose another company's routing data to intelligence", async () => {
    await prisma.routeOptimizationRun.create({
      data: {
        companyId: ids.companyB,
        technicianUserId: ids.techB,
        day: new Date(),
        actorId: ids.techB,
        provider: "mock",
        status: "APPLIED",
        currentSeconds: 9000,
        suggestedSeconds: 1000,
        currentMeters: 80000,
        suggestedMeters: 1000,
        currentJobIds: "[]",
        suggestedJobIds: "[]",
        appliedAt: new Date(),
      },
    });
    const result = await runIntelligenceTool(
      { companyId: ids.companyA, userId: ids.techA, role: "DISPATCHER" },
      "getRouteOptimizationSavings",
      {}
    );
    expect(result.ok).toBe(true);
    const data = result.data as { appliedRuns: number; savedMinutes: number };
    expect(data.appliedRuns).toBe(0);
    expect(data.savedMinutes).toBe(0);
  });
});
