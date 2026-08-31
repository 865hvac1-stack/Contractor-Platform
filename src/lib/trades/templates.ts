import type { Industry } from "@prisma/client";

export type ServiceTypeStarter = {
  key: string;
  name: string;
  description: string;
  playbookKey?: string;
};

export const HVAC_SERVICE_TYPE_STARTERS: ServiceTypeStarter[] = [
  { key: "residential_service_call", name: "Residential Service Call", description: "Residential Service Call", playbookKey: "residential_service" },
  { key: "commercial_service_call", name: "Commercial Service Call", description: "Commercial Service Call", playbookKey: "residential_service" },
  { key: "residential_changeout", name: "Residential Changeout", description: "Residential Changeout", playbookKey: "residential_changeout" },
  { key: "commercial_changeout", name: "Commercial Changeout", description: "Commercial Changeout", playbookKey: "residential_changeout" },
  { key: "residential_routine_maintenance", name: "Residential Routine Maintenance", description: "Residential Routine Maintenance", playbookKey: "residential_maintenance" },
  { key: "commercial_routine_maintenance", name: "Commercial Routine Maintenance", description: "Commercial Routine Maintenance", playbookKey: "commercial_maintenance" },
  { key: "residential_installation", name: "Residential Installation", description: "Residential Installation" },
  { key: "commercial_installation", name: "Commercial Installation", description: "Commercial Installation" },
  { key: "new_construction", name: "New Construction", description: "New Construction" },
  { key: "estimate_sales_call", name: "Estimate / Sales Call", description: "Estimate / Sales Call", playbookKey: "estimate_sales" },
  { key: "warranty_call", name: "Warranty Call", description: "Warranty Call" },
  { key: "inspection", name: "Inspection", description: "Inspection" },
  { key: "emergency_service", name: "Emergency Service", description: "Emergency Service" },
  { key: "other_custom", name: "Other / Custom", description: "" },
];

export const GENERIC_SERVICE_TYPE_STARTERS: ServiceTypeStarter[] = [
  { key: "service_call", name: "Service Call", description: "Service Call" },
  { key: "maintenance", name: "Maintenance", description: "Maintenance" },
  { key: "installation", name: "Installation", description: "Installation" },
  { key: "inspection", name: "Inspection", description: "Inspection" },
  { key: "estimate_sales_call", name: "Estimate / Sales Call", description: "Estimate / Sales Call", playbookKey: "estimate_sales" },
  { key: "emergency_service", name: "Emergency Service", description: "Emergency Service" },
  { key: "warranty_call", name: "Warranty Call", description: "Warranty Call" },
  { key: "other_custom", name: "Other / Custom", description: "" },
];

export function serviceTypeStartersForTrade(trade: Industry | string | null | undefined): ServiceTypeStarter[] {
  if (trade === "HVAC") return HVAC_SERVICE_TYPE_STARTERS;
  return GENERIC_SERVICE_TYPE_STARTERS;
}

/** Future dashboard presets. Not rendered until real widgets exist. */
export function dashboardPresetForTrade(trade: Industry | string | null | undefined) {
  if (trade === "HVAC") {
    return ["service_calls_today", "changeout_pipeline", "maintenance_agreements", "equipment", "average_service_ticket"];
  }
  if (trade === "ROOFING") {
    return ["inspections", "estimates", "production_jobs", "claim_pipeline", "replacement_revenue"];
  }
  if (trade === "POOL_SERVICE") {
    return ["recurring_routes", "stops_today", "service_contracts", "chemical_visits"];
  }
  return ["jobs_today", "open_estimates", "invoices_due", "average_ticket"];
}
