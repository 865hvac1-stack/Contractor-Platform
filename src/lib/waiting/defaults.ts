import type { WaitingCadence } from "@prisma/client";
import type { DefaultColumnKey, WaitingTemplateKind } from "@/lib/waiting/types";

export const DEFAULT_CADENCE: WaitingCadence = "EVERY_3_DAYS";

export const DEFAULT_COLUMNS: Array<{
  key: DefaultColumnKey;
  name: string;
  kind: "WAITING" | "READY";
  sortOrder: number;
  warningDays: number;
  urgentDays: number;
}> = [
  { key: "WAITING_ON_PART", name: "Waiting on Part", kind: "WAITING", sortOrder: 0, warningDays: 5, urgentDays: 10 },
  { key: "WAITING_ON_WARRANTY", name: "Waiting on Warranty", kind: "WAITING", sortOrder: 1, warningDays: 7, urgentDays: 14 },
  { key: "WAITING_ON_CUSTOMER", name: "Waiting on Customer", kind: "WAITING", sortOrder: 2, warningDays: 3, urgentDays: 7 },
  { key: "WAITING_ON_APPROVAL", name: "Waiting on Approval", kind: "WAITING", sortOrder: 3, warningDays: 3, urgentDays: 7 },
  { key: "WAITING_ON_THIRD_PARTY", name: "Waiting on Third Party", kind: "WAITING", sortOrder: 4, warningDays: 5, urgentDays: 10 },
  { key: "READY_TO_SCHEDULE", name: "Ready to Schedule", kind: "READY", sortOrder: 5, warningDays: 1, urgentDays: 3 },
];

export const DEFAULT_TEMPLATES: Array<{
  columnKey: DefaultColumnKey | null;
  kind: WaitingTemplateKind;
  name: string;
  body: string;
}> = [
  {
    columnKey: "WAITING_ON_PART",
    kind: "INITIAL",
    name: "Part ordered",
    body: "Hi {{firstName}}, this is {{companyName}}. We've ordered the {{itemName}} needed for your service. We're tracking it and will keep you updated so you don't have to call us for status.{{expectedDateSentence}}",
  },
  {
    columnKey: "WAITING_ON_PART",
    kind: "RECURRING",
    name: "Still waiting on part",
    body: "Hi {{firstName}}, quick update from {{companyName}}. We're still waiting on your {{itemName}} to arrive. We're keeping an eye on it and will update you again as soon as we know more.",
  },
  {
    columnKey: "WAITING_ON_PART",
    kind: "ARRIVED",
    name: "Part arrived",
    body: "Good news, {{firstName}} — your {{itemName}} has arrived. Our team is ready to get your service back on the schedule. We'll be in touch shortly to arrange the next step.",
  },
  {
    columnKey: "WAITING_ON_WARRANTY",
    kind: "INITIAL",
    name: "Warranty in progress",
    body: "Hi {{firstName}}, this is {{companyName}}. We're working with the warranty provider on your service and will keep you updated as it moves forward.",
  },
  {
    columnKey: "WAITING_ON_WARRANTY",
    kind: "RECURRING",
    name: "Warranty still open",
    body: "Hi {{firstName}}, quick update from {{companyName}}. Your warranty claim is still in progress. We'll reach out as soon as we have a decision.",
  },
  {
    columnKey: "WAITING_ON_CUSTOMER",
    kind: "INITIAL",
    name: "Waiting on you",
    body: "Hi {{firstName}}, this is {{companyName}}. We're waiting on {{waitingFor}} before we can move your service forward. Reply here when you're ready and we'll take the next step.",
  },
  {
    columnKey: "WAITING_ON_CUSTOMER",
    kind: "RECURRING",
    name: "Still waiting on customer",
    body: "Hi {{firstName}}, this is {{companyName}}. Just checking in — we still need {{waitingFor}} so we can get your service moving again.",
  },
  {
    columnKey: "WAITING_ON_APPROVAL",
    kind: "INITIAL",
    name: "Approval needed",
    body: "Hi {{firstName}}, this is {{companyName}}. We're waiting on approval to proceed with your service. Reply here if you have questions and we'll keep this from sitting.",
  },
  {
    columnKey: "WAITING_ON_APPROVAL",
    kind: "RECURRING",
    name: "Approval still open",
    body: "Hi {{firstName}}, this is {{companyName}}. Your approval is still open. Let us know how you'd like to proceed and we'll get the next step scheduled.",
  },
  {
    columnKey: "WAITING_ON_THIRD_PARTY",
    kind: "INITIAL",
    name: "Third party in progress",
    body: "Hi {{firstName}}, this is {{companyName}}. We're waiting on a third party to complete their part of your service. We'll keep you posted.",
  },
  {
    columnKey: "WAITING_ON_THIRD_PARTY",
    kind: "RECURRING",
    name: "Still waiting on third party",
    body: "Hi {{firstName}}, quick update from {{companyName}}. We're still waiting on the third party for your service and will update you when we have news.",
  },
  {
    columnKey: "READY_TO_SCHEDULE",
    kind: "READY",
    name: "Ready to schedule",
    body: "Hi {{firstName}}, this is {{companyName}}. We're ready to get your service back on the schedule. We'll be in touch shortly to arrange the next step.",
  },
  {
    columnKey: "READY_TO_SCHEDULE",
    kind: "INITIAL",
    name: "Ready to schedule",
    body: "Hi {{firstName}}, this is {{companyName}}. We're ready to get your service back on the schedule. We'll be in touch shortly to arrange the next step.",
  },
  {
    columnKey: null,
    kind: "INITIAL",
    name: "Waiting confirmation",
    body: "Hi {{firstName}}, this is {{companyName}}. Your service is temporarily waiting — {{waitingReason}}. We'll keep you updated so you don't have to call for status.",
  },
  {
    columnKey: null,
    kind: "RECURRING",
    name: "Still waiting",
    body: "Hi {{firstName}}, quick update from {{companyName}}. We're still working through {{waitingReason}} and will update you again as soon as we know more.",
  },
  {
    columnKey: null,
    kind: "RESOLVED",
    name: "Waiting resolved",
    body: "Hi {{firstName}}, this is {{companyName}}. The hold on your service is cleared. We'll take the next step from here.",
  },
];

export const CADENCE_LABELS: Record<WaitingCadence, string> = {
  DAILY: "Daily",
  EVERY_2_DAYS: "Every 2 days",
  EVERY_3_DAYS: "Every 3 days",
  WEEKLY: "Weekly",
  CUSTOM: "Custom",
  MANUAL: "Manual only",
};
