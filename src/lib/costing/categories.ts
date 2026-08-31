import type { ExpenseCategory, JobCostCategory } from "@prisma/client";

export function expenseToJobCostCategory(category: ExpenseCategory | null | undefined): JobCostCategory {
  switch (category) {
    case "MATERIALS":
      return "MATERIALS";
    case "EQUIPMENT":
    case "TOOLS":
      return "EQUIPMENT";
    case "FUEL":
    case "VEHICLE":
      return "FUEL";
    case "SUBCONTRACTOR":
      return "SUBCONTRACTOR";
    case "PERMITS":
      return "PERMIT";
    default:
      return "OTHER";
  }
}

export const JOB_COST_LABELS: Record<JobCostCategory, string> = {
  EQUIPMENT: "Equipment",
  MATERIALS: "Materials",
  LABOR: "Labor",
  SUBCONTRACTOR: "Subcontractor",
  PERMIT: "Permit",
  FUEL: "Fuel",
  RENTAL: "Rental",
  INVENTORY: "Inventory used",
  OTHER: "Other",
};
