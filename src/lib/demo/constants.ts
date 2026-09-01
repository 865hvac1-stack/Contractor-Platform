export const SUMMIT_COMPANY_NAME = "Summit Home Services";
export const SUMMIT_SHORT_NAME = "Summit";
export const SUMMIT_TAGLINE = "Comfort. Done Right.";
export const SUMMIT_DESCRIPTION =
  "Summit Home Services is a fictional residential home-service company providing heating, cooling, indoor air quality, plumbing, water heater, and maintenance services.";
export const SUMMIT_PHONE = "(865) 555-0148";
export const SUMMIT_EMAIL = "hello@summithomeservices.demo";
export const SUMMIT_WEBSITE = "https://summithomeservices.demo";
export const SUMMIT_CITY = "Knoxville";
export const SUMMIT_STATE = "TN";
export const SUMMIT_ZIP = "37919";
export const SUMMIT_ADDRESS = "1840 Demo Ridge Way";
export const SUMMIT_SERVICE_AREA =
  "Knoxville, Farragut, Powell, Halls, Corryton, Karns, Hardin Valley, Oak Ridge, Maryville, Alcoa";
export const SUMMIT_HOURS =
  "Monday-Friday 7:00 AM-6:00 PM · Saturday 8:00 AM-2:00 PM · Emergency service available";
export const SUMMIT_NAVY = "#12233F";
export const SUMMIT_ORANGE = "#FF6A1A";
export const SUMMIT_LOGO_HORIZONTAL = "/demo/summit/logo-horizontal.svg";
export const SUMMIT_LOGO_MARK = "/demo/summit/logo-mark.svg";
export const SUMMIT_LOGO_DARK = "/demo/summit/logo-dark.svg";
export const DEMO_SOURCE = "DEMO";
export const DEMO_PROVIDER = "demo";
export const DEMO_BLOCKED_MESSAGE = "Demo mode — no external action was performed.";
export const DEMO_PASSWORD = process.env.SUMMIT_DEMO_PASSWORD || "SummitDemo-2026!";
export const DEMO_EMAIL_DOMAIN = "summithomeservices.demo";
export const DEMO_CUSTOMER_EMAIL_DOMAIN = "customers.summit-demo.example";

export const SUMMIT_TEAM = [
  { key: "jake", firstName: "Jake", lastName: "Bennett", role: "COMPANY_OWNER" as const, title: "Owner" },
  { key: "sarah", firstName: "Sarah", lastName: "Mitchell", role: "MANAGER" as const, title: "Operations Manager" },
  { key: "emily", firstName: "Emily", lastName: "Carter", role: "DISPATCHER" as const, title: "Dispatcher" },
  { key: "megan", firstName: "Megan", lastName: "Brooks", role: "OFFICE" as const, title: "CSR" },
  { key: "ashley", firstName: "Ashley", lastName: "Reed", role: "OFFICE" as const, title: "CSR" },
  { key: "tyler", firstName: "Tyler", lastName: "Morgan", role: "SALES" as const, title: "Comfort Advisor" },
  { key: "chris", firstName: "Chris", lastName: "Walker", role: "TECHNICIAN" as const, title: "Service Technician" },
  { key: "daniel", firstName: "Daniel", lastName: "Hayes", role: "TECHNICIAN" as const, title: "Service Technician" },
  { key: "marcus", firstName: "Marcus", lastName: "Reed", role: "TECHNICIAN" as const, title: "Service Technician" },
  { key: "austin", firstName: "Austin", lastName: "Cole", role: "TECHNICIAN" as const, title: "Service Technician" },
  { key: "ryan", firstName: "Ryan", lastName: "Foster", role: "TECHNICIAN" as const, title: "Service Technician" },
  { key: "ethan", firstName: "Ethan", lastName: "Parker", role: "INSTALLER" as const, title: "Install Technician" },
  { key: "luke", firstName: "Luke", lastName: "Davis", role: "INSTALLER" as const, title: "Install Technician" },
  { key: "jordan", firstName: "Jordan", lastName: "Blake", role: "TECHNICIAN" as const, title: "Plumbing Technician" },
] as const;

export function demoUserEmail(firstName: string, lastName: string) {
  return `${firstName}.${lastName}@${DEMO_EMAIL_DOMAIN}`.toLowerCase();
}
