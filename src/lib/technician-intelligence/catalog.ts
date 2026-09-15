import { prisma } from "@/lib/db";

const HVAC_CATEGORIES = [
  ["NO_COOLING", "No Cooling", ["NO COOL", "AC NOT COOLING", "COOLING PROBLEM"]],
  ["NO_HEATING", "No Heating", ["NO HEAT", "HEATING PROBLEM"]],
  ["HEAT_PUMP", "Heat Pump Diagnostics", ["HEAT PUMP"]],
  ["GAS_FURNACE", "Gas Furnace Diagnostics", ["GAS FURNACE"]],
  ["ELECTRICAL", "Electrical Diagnostics", ["ELECTRICAL"]],
  ["REFRIGERATION", "Refrigeration Diagnostics", ["REFRIGERATION"]],
  ["CONTROLS", "Controls / Thermostats", ["THERMOSTAT", "CONTROLS"]],
  ["AIRFLOW_DUCT", "Airflow / Duct Diagnostics", ["AIRFLOW", "DUCT"]],
  ["IAQ", "Indoor Air Quality", ["IAQ", "INDOOR AIR QUALITY"]],
  ["MAINTENANCE", "Maintenance", ["TUNE UP", "TUNE-UP", "PM"]],
  ["COMMERCIAL", "Commercial Service", ["COMMERCIAL"]],
  ["INSTALL", "Install / Changeout", ["INSTALL", "CHANGEOUT", "REPLACEMENT"]],
  ["OTHER", "Other", []],
] as const;

const HVAC_SKILLS = [
  ["NO_COOLING", "No Cooling", "SERVICE", "NO_COOLING"],
  ["NO_HEATING", "No Heating", "SERVICE", "NO_HEATING"],
  ["HEAT_PUMP_DIAGNOSTICS", "Heat Pump Diagnostics", "SERVICE", "HEAT_PUMP"],
  ["GAS_FURNACE_DIAGNOSTICS", "Gas Furnace Diagnostics", "SERVICE", "GAS_FURNACE"],
  ["ELECTRICAL_DIAGNOSTICS", "Electrical Diagnostics", "SERVICE", "ELECTRICAL"],
  ["REFRIGERATION_DIAGNOSTICS", "Refrigeration Diagnostics", "SERVICE", "REFRIGERATION"],
  ["CONTROLS_THERMOSTATS", "Controls / Thermostats", "SERVICE", "CONTROLS"],
  ["AIRFLOW_DUCT_DIAGNOSTICS", "Airflow / Duct Diagnostics", "SERVICE", "AIRFLOW_DUCT"],
  ["IAQ", "Indoor Air Quality", "SERVICE", "IAQ"],
  ["MAINTENANCE", "Maintenance", "SERVICE", "MAINTENANCE"],
  ["COMMERCIAL_SERVICE", "Commercial Service", "SERVICE", "COMMERCIAL"],
  ["OPTIONS_PRESENTATION", "Options Presentation", "OPPORTUNITY", null],
  ["REPLACEMENT_OPPORTUNITIES", "Replacement Opportunities", "OPPORTUNITY", "INSTALL"],
  ["MEMBERSHIPS", "Memberships", "OPPORTUNITY", "MAINTENANCE"],
  ["IAQ_OPPORTUNITIES", "IAQ Opportunities", "OPPORTUNITY", "IAQ"],
  ["CHANGEOUT_REPLACEMENT", "Changeout / Replacement", "INSTALL", "INSTALL"],
  ["STARTUP_COMMISSIONING", "Startup / Commissioning", "INSTALL", "INSTALL"],
  ["DUCTWORK", "Ductwork", "INSTALL", "AIRFLOW_DUCT"],
  ["NEW_CONSTRUCTION", "New Construction", "INSTALL", "INSTALL"],
  ["PUNCH_WARRANTY", "Punch / Warranty", "INSTALL", "INSTALL"],
] as const;

const HVAC_QUALIFICATIONS = [
  ["EPA_UNIVERSAL", "EPA Universal"],
  ["EPA_TYPE_I", "EPA Type I"],
  ["EPA_TYPE_II", "EPA Type II"],
  ["EPA_TYPE_III", "EPA Type III"],
  ["GAS_EQUIPMENT", "Gas Equipment"],
  ["HEAT_PUMP", "Heat Pump"],
  ["COMMERCIAL", "Commercial"],
  ["ELECTRICAL_DIAGNOSTICS", "Electrical Diagnostics"],
  ["MANUFACTURER_CERTIFICATION", "Manufacturer Certification"],
  ["OTHER", "Other"],
] as const;

export async function ensureTechnicianIntelligenceCatalog(companyId: string, industry: string) {
  if (industry !== "HVAC") return;
  const categoryIds = new Map<string, string>();
  for (let index = 0; index < HVAC_CATEGORIES.length; index++) {
    const [key, name, aliases] = HVAC_CATEGORIES[index];
    const category = await prisma.technicianJobCategory.upsert({
      where: { companyId_key: { companyId, key } },
      update: {},
      create: { companyId, key, name, aliases: [...aliases], sortOrder: (index + 1) * 10 },
    });
    categoryIds.set(key, category.id);
  }
  for (let index = 0; index < HVAC_SKILLS.length; index++) {
    const [key, name, group, categoryKey] = HVAC_SKILLS[index];
    await prisma.technicianSkillDefinition.upsert({
      where: { companyId_key: { companyId, key } },
      update: {},
      create: {
        companyId,
        key,
        name,
        group,
        categoryId: categoryKey ? categoryIds.get(categoryKey) : null,
        sortOrder: (index + 1) * 10,
      },
    });
  }
  for (let index = 0; index < HVAC_QUALIFICATIONS.length; index++) {
    const [key, name] = HVAC_QUALIFICATIONS[index];
    await prisma.technicianQualificationDefinition.upsert({
      where: { companyId_key: { companyId, key } },
      update: {},
      create: { companyId, key, name, sortOrder: (index + 1) * 10 },
    });
  }
}
