import { nanoid } from "nanoid";
import type { PlaybookDefinition, PlaybookStepDef } from "@/lib/playbooks/types";
import { EMPTY_DEFINITION } from "@/lib/playbooks/types";

function step(partial: Omit<PlaybookStepDef, "id" | "audience"> & { audience?: PlaybookStepDef["audience"] }): PlaybookStepDef {
  return { audience: "ALL", ...partial, id: nanoid(10) };
}

function item(label: string, required = false) {
  return { id: nanoid(10), label, required, fieldType: "CHECKBOX" as const };
}

export type StarterTemplate = {
  key: string;
  name: string;
  description: string;
  definition: PlaybookDefinition;
};

function withPhases(
  patches: Partial<Record<PlaybookDefinition["phases"][number]["key"], Partial<PlaybookDefinition["phases"][number]>>>
): PlaybookDefinition {
  return {
    phases: EMPTY_DEFINITION.phases.map((phase) => ({
      ...phase,
      ...patches[phase.key],
      key: phase.key,
      name: patches[phase.key]?.name ?? phase.name,
    })),
  };
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: "residential_service",
    name: "Residential Service",
    description: "Friendly SMS updates, diagnosis, options, invoice, then a review request.",
    definition: withPhases({
      BEFORE_JOB: {
        stages: [{ key: "scheduled", name: "Scheduled" }],
        steps: [
          step({
            kind: "MESSAGE",
            title: "Send appointment reminder",
            when: "24 hours before",
            enabled: true,
            required: false,
            audience: "OFFICE",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, this is a reminder that {{company.name}} is scheduled for {{job.date}} at {{job.time}}. Reply if you need to reschedule. {{company.phone}}",
            },
          }),
          step({
            kind: "MESSAGE",
            title: "Send appointment reminder",
            when: "2 hours before",
            enabled: true,
            required: false,
            audience: "OFFICE",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, {{company.name}} will be there around {{job.arrivalWindow}}. See you soon.",
            },
          }),
        ],
      },
      ON_THE_WAY: {
        stages: [{ key: "on_my_way", name: "On my way" }],
        steps: [
          step({
            kind: "ACTION",
            title: "On my way",
            when: "When technician taps On my way",
            enabled: true,
            required: false,
            audience: "TECHNICIAN",
            actionKey: "ON_MY_WAY",
            mapsToJobStatus: "DISPATCHED",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, {{technician.firstName}} from {{company.name}} is on the way to {{property.address}}. Expected arrival: {{job.arrivalWindow}}. Need anything? Call {{company.phone}}.",
            },
          }),
        ],
      },
      AT_THE_JOB: {
        stages: [
          { key: "arrived", name: "Arrived" },
          { key: "diagnosing", name: "Diagnosing" },
          { key: "waiting_approval", name: "Waiting approval" },
          { key: "repairing", name: "Repairing" },
        ],
        steps: [
          step({
            kind: "ACTION",
            title: "Check in",
            when: "When technician arrives",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            actionKey: "ARRIVED",
            mapsToJobStatus: "IN_PROGRESS",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, {{technician.firstName}} from {{company.name}} has arrived at {{property.address}}.",
            },
          }),
          step({
            kind: "REQUIREMENT",
            title: "Add diagnosis",
            when: "At the job",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            actionKey: "DIAGNOSIS",
          }),
          step({
            kind: "REQUIREMENT",
            title: "Add repair recommendation",
            when: "At the job",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            actionKey: "RECOMMENDATION",
          }),
          step({
            kind: "PHOTO",
            title: "Add photos",
            when: "At the job",
            enabled: false,
            required: false,
            audience: "TECHNICIAN",
            photo: { minCount: 1, label: "Repair photos" },
          }),
          step({
            kind: "REQUIREMENT",
            title: "Add equipment information",
            when: "At the job",
            enabled: false,
            required: false,
            audience: "TECHNICIAN",
            actionKey: "EQUIPMENT",
          }),
        ],
      },
      BEFORE_COMPLETE: {
        stages: [],
        steps: [
          step({
            kind: "CHECKLIST",
            title: "Complete required checklist",
            when: "Before completing job",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            checklist: {
              sections: [
                {
                  name: "Close-out",
                  items: [item("Work explained to customer", true), item("Site left clean", true)],
                },
              ],
            },
          }),
          step({
            kind: "REQUIREMENT",
            title: "Complete invoice",
            when: "Before completing job",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            actionKey: "INVOICE",
          }),
          step({
            kind: "REQUIREMENT",
            title: "Require payment",
            when: "Before completing job",
            enabled: false,
            required: false,
            audience: "OFFICE",
            actionKey: "PAYMENT",
          }),
          step({
            kind: "REQUIREMENT",
            title: "Collect customer signature",
            when: "Before completing job",
            enabled: false,
            required: false,
            audience: "TECHNICIAN",
            actionKey: "SIGNATURE",
          }),
        ],
      },
      AFTER_JOB: {
        stages: [{ key: "completed", name: "Completed" }],
        steps: [
          step({
            kind: "MESSAGE",
            title: "Send thank you",
            when: "After the job is completed",
            enabled: true,
            required: false,
            audience: "OFFICE",
            message: {
              channel: "SMS",
              body: "Thank you, {{customer.firstName}} — it was a pleasure working with you today. {{company.name}} is here if you need us. {{company.phone}}",
            },
          }),
          step({
            kind: "MESSAGE",
            title: "Request review",
            when: "After the job is completed",
            enabled: true,
            required: false,
            audience: "OFFICE",
            waitMinutes: 30,
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, if {{company.name}} earned it, a quick review helps neighbors find us. Thank you!",
            },
          }),
          step({
            kind: "FOLLOW_UP",
            title: "Send membership offer",
            when: "After the job",
            enabled: false,
            required: false,
            audience: "OFFICE",
          }),
          step({
            kind: "FOLLOW_UP",
            title: "Schedule future follow-up",
            when: "After the job",
            enabled: false,
            required: false,
            audience: "OFFICE",
          }),
        ],
      },
    }),
  },
  {
    key: "residential_maintenance",
    name: "Residential Maintenance",
    description: "Checklist-heavy visit, equipment notes, recommended repairs, then next tune-up.",
    definition: withPhases({
      ON_THE_WAY: {
        stages: [{ key: "on_my_way", name: "On my way" }],
        steps: [
          step({
            kind: "ACTION",
            title: "On my way",
            when: "When technician taps On my way",
            enabled: true,
            required: false,
            audience: "TECHNICIAN",
            actionKey: "ON_MY_WAY",
            mapsToJobStatus: "DISPATCHED",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, {{technician.firstName}} from {{company.name}} is on the way for your maintenance visit.",
            },
          }),
        ],
      },
      AT_THE_JOB: {
        stages: [
          { key: "arrived", name: "Arrived" },
          { key: "maintenance", name: "Maintenance in progress" },
        ],
        steps: [
          step({
            kind: "ACTION",
            title: "Check in",
            when: "When technician arrives",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            actionKey: "ARRIVED",
            mapsToJobStatus: "IN_PROGRESS",
          }),
          step({
            kind: "CHECKLIST",
            title: "Maintenance checklist",
            when: "At the job",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            checklist: {
              sections: [
                {
                  name: "Indoor unit",
                  items: [
                    item("Filter inspected", true),
                    item("Blower inspected", true),
                    item("Drain cleared", true),
                    item("Electrical inspected", true),
                  ],
                },
                {
                  name: "Outdoor unit",
                  items: [
                    item("Coil inspected", true),
                    item("Capacitor checked"),
                    item("Contactor inspected"),
                    item("Readings recorded"),
                  ],
                },
              ],
            },
          }),
          step({
            kind: "PHOTO",
            title: "Add photos",
            when: "At the job",
            enabled: true,
            required: false,
            audience: "TECHNICIAN",
            photo: { minCount: 2, label: "Equipment photos" },
          }),
        ],
      },
      AFTER_JOB: {
        stages: [{ key: "completed", name: "Completed" }],
        steps: [
          step({
            kind: "MESSAGE",
            title: "Request review",
            when: "After completion",
            enabled: true,
            required: false,
            audience: "OFFICE",
            message: {
              channel: "SMS",
              body: "Thanks for trusting {{company.name}} with your maintenance, {{customer.firstName}}.",
            },
          }),
          step({
            kind: "FOLLOW_UP",
            title: "Schedule next maintenance",
            when: "After the job",
            enabled: true,
            required: false,
            audience: "OFFICE",
          }),
        ],
      },
    }),
  },
  {
    key: "commercial_maintenance",
    name: "Commercial Maintenance",
    description: "Site check-in, equipment list, deficiencies, service report — not residential language.",
    definition: withPhases({
      ON_THE_WAY: {
        stages: [{ key: "on_my_way", name: "On my way" }],
        steps: [
          step({
            kind: "ACTION",
            title: "On my way",
            when: "When technician taps On my way",
            enabled: true,
            required: false,
            audience: "TECHNICIAN",
            actionKey: "ON_MY_WAY",
            mapsToJobStatus: "DISPATCHED",
            message: {
              channel: "EMAIL",
              body: "{{company.name}} technician {{technician.fullName}} is en route to {{property.address}} for scheduled maintenance. Window: {{job.arrivalWindow}}.",
            },
          }),
        ],
      },
      AT_THE_JOB: {
        stages: [
          { key: "checked_in", name: "Checked in" },
          { key: "in_progress", name: "Maintenance in progress" },
          { key: "deficiencies", name: "Deficiencies found" },
          { key: "report", name: "Service report" },
        ],
        steps: [
          step({
            kind: "ACTION",
            title: "Site check-in",
            when: "On arrival",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            actionKey: "ARRIVED",
            mapsToJobStatus: "IN_PROGRESS",
          }),
          step({
            kind: "CHECKLIST",
            title: "Maintenance checklist per equipment",
            when: "At the site",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            checklist: {
              sections: [
                {
                  name: "Site",
                  items: [item("Site contact confirmed", true), item("Equipment list reviewed", true)],
                },
                {
                  name: "Readings",
                  items: [item("Measurements recorded", true), item("Photos attached")],
                },
              ],
            },
          }),
          step({
            kind: "REQUIREMENT",
            title: "Note deficiencies and recommendations",
            when: "At the site",
            enabled: true,
            required: true,
            audience: "TECHNICIAN",
            actionKey: "RECOMMENDATION",
          }),
          step({
            kind: "REQUIREMENT",
            title: "Property manager signature",
            when: "Before leaving",
            enabled: false,
            required: false,
            audience: "TECHNICIAN",
            actionKey: "SIGNATURE",
          }),
        ],
      },
      AFTER_JOB: {
        stages: [{ key: "completed", name: "Completed" }],
        steps: [
          step({
            kind: "MESSAGE",
            title: "Email service report",
            when: "After completion",
            enabled: true,
            required: false,
            audience: "OFFICE",
            message: {
              channel: "EMAIL",
              body: "Service report for {{property.address}} is ready. {{company.name}} · {{company.phone}}",
            },
          }),
          step({
            kind: "FOLLOW_UP",
            title: "Follow up on recommended repairs",
            when: "After the job",
            enabled: true,
            required: false,
            audience: "OFFICE",
          }),
        ],
      },
    }),
  },
  {
    key: "residential_changeout",
    name: "Residential Changeout",
    description: "Crew, before/after photos, startup, walkthrough, warranty, then maintenance offer.",
    definition: withPhases({
      BEFORE_JOB: {
        stages: [
          { key: "scheduled", name: "Scheduled" },
          { key: "crew_assigned", name: "Crew assigned" },
        ],
        steps: [
          step({
            kind: "MESSAGE",
            title: "Install confirmation",
            when: "When the job is scheduled",
            enabled: true,
            required: false,
            audience: "OFFICE",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, your {{company.name}} installation is set for {{job.date}}. We'll confirm the crew the day before.",
            },
          }),
        ],
      },
      ON_THE_WAY: {
        stages: [{ key: "on_my_way", name: "On my way" }],
        steps: [
          step({
            kind: "ACTION",
            title: "On my way",
            when: "When the crew taps On my way",
            enabled: true,
            required: false,
            audience: "INSTALLER",
            actionKey: "ON_MY_WAY",
            mapsToJobStatus: "DISPATCHED",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, the {{company.name}} install crew is on the way to {{property.address}}.",
            },
          }),
        ],
      },
      AT_THE_JOB: {
        stages: [
          { key: "install_started", name: "Installation started" },
          { key: "startup", name: "Startup / commissioning" },
          { key: "walkthrough", name: "Customer walkthrough" },
        ],
        steps: [
          step({
            kind: "PHOTO",
            title: "Before photos",
            when: "Before removal",
            enabled: true,
            required: true,
            audience: "INSTALLER",
            photo: { minCount: 3, label: "Before photos" },
          }),
          step({
            kind: "CHECKLIST",
            title: "Startup / commissioning",
            when: "After install",
            enabled: true,
            required: true,
            audience: "INSTALLER",
            checklist: {
              sections: [
                {
                  name: "Startup",
                  items: [
                    item("Model / serial captured", true),
                    item("Warranty information recorded", true),
                    item("System started and tested", true),
                  ],
                },
              ],
            },
          }),
          step({
            kind: "PHOTO",
            title: "Final photos",
            when: "After install",
            enabled: true,
            required: true,
            audience: "INSTALLER",
            photo: { minCount: 3, label: "After photos" },
          }),
          step({
            kind: "REQUIREMENT",
            title: "Customer walkthrough and signature",
            when: "Before leaving",
            enabled: true,
            required: true,
            audience: "INSTALLER",
            actionKey: "SIGNATURE",
          }),
        ],
      },
      AFTER_JOB: {
        stages: [{ key: "completed", name: "Completed" }],
        steps: [
          step({
            kind: "MESSAGE",
            title: "Request review",
            when: "After completion",
            enabled: true,
            required: false,
            audience: "OFFICE",
            message: {
              channel: "SMS",
              body: "Thanks for choosing {{company.name}} for your installation, {{customer.firstName}}.",
            },
          }),
          step({
            kind: "FOLLOW_UP",
            title: "Offer maintenance enrollment",
            when: "After the job",
            enabled: true,
            required: false,
            audience: "OFFICE",
          }),
        ],
      },
    }),
  },
  {
    key: "estimate_sales",
    name: "Estimate / Sales Call",
    description: "Show-up, options, estimate, follow-up — no repair checklist.",
    definition: withPhases({
      ON_THE_WAY: {
        stages: [{ key: "on_my_way", name: "On my way" }],
        steps: [
          step({
            kind: "ACTION",
            title: "On my way",
            when: "When sales taps On my way",
            enabled: true,
            required: false,
            audience: "SALES",
            actionKey: "ON_MY_WAY",
            mapsToJobStatus: "DISPATCHED",
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, {{technician.firstName}} from {{company.name}} is on the way to walk through options with you.",
            },
          }),
        ],
      },
      AT_THE_JOB: {
        stages: [
          { key: "arrived", name: "Arrived" },
          { key: "options", name: "Options" },
        ],
        steps: [
          step({
            kind: "ACTION",
            title: "Arrived",
            when: "On arrival",
            enabled: true,
            required: true,
            audience: "SALES",
            actionKey: "ARRIVED",
            mapsToJobStatus: "IN_PROGRESS",
          }),
          step({
            kind: "REQUIREMENT",
            title: "Create estimate",
            when: "At the visit",
            enabled: true,
            required: true,
            audience: "SALES",
            actionKey: "ESTIMATE",
          }),
        ],
      },
      AFTER_JOB: {
        stages: [{ key: "completed", name: "Completed" }],
        steps: [
          step({
            kind: "MESSAGE",
            title: "Estimate follow-up",
            when: "If the estimate is still open",
            enabled: true,
            required: false,
            audience: "OFFICE",
            waitMinutes: 2880,
            message: {
              channel: "SMS",
              body: "Hi {{customer.firstName}}, just checking in on estimate {{estimate.number}} from {{company.name}}. Questions? {{company.phone}}",
            },
          }),
        ],
      },
    }),
  },
];

export function getStarterTemplate(key: string) {
  const found = STARTER_TEMPLATES.find((t) => t.key === key) ?? null;
  if (!found) return null;
  return {
    ...found,
    definition: structuredClone(found.definition),
  };
}
