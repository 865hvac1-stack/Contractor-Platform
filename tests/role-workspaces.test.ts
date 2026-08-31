import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { can } from "@/lib/permissions";
import { getDispatchBoard } from "@/lib/dispatch/board";
import {
  accessibleWorkspaces,
  canAccessWorkspace,
  landingPath,
} from "@/lib/workspaces";

const prisma = new PrismaClient();

describe("role landing and workspace access", () => {
  it("routes each primary role to the correct operating experience", () => {
    expect(landingPath("COMPANY_OWNER")).toBe("/dashboard");
    expect(landingPath("ADMIN")).toBe("/dashboard");
    expect(landingPath("MANAGER")).toBe("/dashboard");
    expect(landingPath("DISPATCHER")).toBe("/dispatch");
    expect(landingPath("OFFICE")).toBe("/office");
    expect(landingPath("SALES")).toBe("/office");
    expect(landingPath("TECHNICIAN")).toBe("/tech");
    expect(landingPath("INSTALLER")).toBe("/tech");
  });

  it("lets owners switch workspaces without a second account", () => {
    expect(canAccessWorkspace("COMPANY_OWNER", "command")).toBe(true);
    expect(canAccessWorkspace("COMPANY_OWNER", "dispatch")).toBe(true);
    expect(canAccessWorkspace("COMPANY_OWNER", "office")).toBe(true);
    expect(canAccessWorkspace("COMPANY_OWNER", "field")).toBe(false);
    expect(accessibleWorkspaces("COMPANY_OWNER")).toEqual(["command", "dispatch", "office"]);
  });

  it("lets a multi-role office employee use CSR and Dispatch", () => {
    expect(canAccessWorkspace("OFFICE", "office")).toBe(true);
    expect(canAccessWorkspace("OFFICE", "dispatch")).toBe(true);
    expect(canAccessWorkspace("OFFICE", "command")).toBe(false);
    expect(canAccessWorkspace("DISPATCHER", "dispatch")).toBe(true);
    expect(canAccessWorkspace("DISPATCHER", "office")).toBe(true);
    expect(canAccessWorkspace("DISPATCHER", "command")).toBe(false);
  });

  it("keeps technicians out of owner, dispatch, and CSR workspaces", () => {
    expect(canAccessWorkspace("TECHNICIAN", "command")).toBe(false);
    expect(canAccessWorkspace("TECHNICIAN", "dispatch")).toBe(false);
    expect(canAccessWorkspace("TECHNICIAN", "office")).toBe(false);
    expect(canAccessWorkspace("TECHNICIAN", "field")).toBe(true);
    expect(canAccessWorkspace("INSTALLER", "command")).toBe(false);
  });

  it("is permission-driven for managers instead of a single hardcoded shell", () => {
    expect(canAccessWorkspace("MANAGER", "command")).toBe(true);
    expect(canAccessWorkspace("MANAGER", "dispatch")).toBe(true);
    expect(canAccessWorkspace("MANAGER", "office")).toBe(true);
    expect(can("MANAGER", "schedule:manage")).toBe(true);
    expect(can("MANAGER", "routing:optimize")).toBe(true);
  });
});

describe("workspace field-level permissions", () => {
  it("hides owner financial and compensation data from CSR and dispatch", () => {
    expect(can("OFFICE", "reports:financial")).toBe(false);
    expect(can("OFFICE", "compensation:view_all")).toBe(false);
    expect(can("OFFICE", "job_costs:view")).toBe(false);
    expect(can("OFFICE", "pricebook:cost")).toBe(false);
    expect(can("OFFICE", "invoices:view")).toBe(true);
    expect(can("DISPATCHER", "invoices:financial")).toBe(false);
    expect(can("DISPATCHER", "accounting:manage")).toBe(false);
    expect(can("DISPATCHER", "reports:financial")).toBe(false);
    expect(can("DISPATCHER", "marketing:view")).toBe(false);
    expect(can("TECHNICIAN", "invoices:financial")).toBe(false);
    expect(can("TECHNICIAN", "reports:financial")).toBe(false);
  });

  it("grants dispatch routing and lock permissions to authorized operators", () => {
    expect(can("COMPANY_OWNER", "routing:optimize")).toBe(true);
    expect(can("DISPATCHER", "routing:optimize")).toBe(true);
    expect(can("DISPATCHER", "jobs:lock")).toBe(true);
    expect(can("TECHNICIAN", "routing:optimize")).toBe(false);
    expect(can("TECHNICIAN", "jobs:lock")).toBe(false);
    expect(can("SALES", "routing:optimize")).toBe(false);
  });
});

describe("dispatch board query", () => {
  it("loads an empty board without a Prisma validation error", async () => {
    const company = await prisma.company.create({
      data: { businessName: `Dispatch board ${Date.now()}`, industry: "HVAC", status: "ACTIVE" },
    });
    const board = await getDispatchBoard(company.id, new Date());
    expect(board.unassigned).toEqual([]);
    expect(board.technicians).toEqual([]);
    expect(board.exceptions).toEqual([]);
    await prisma.company.delete({ where: { id: company.id } });
    await prisma.$disconnect();
  });
});
