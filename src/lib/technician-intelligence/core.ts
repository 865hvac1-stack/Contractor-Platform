export const CONFIDENCE_THRESHOLDS = {
  low: 5,
  medium: 20,
  high: 50,
} as const;

export type DataConfidence = "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH";

export function confidenceForSampleSize(
  sampleSize: number,
  thresholds = CONFIDENCE_THRESHOLDS
): DataConfidence {
  if (sampleSize < thresholds.low) return "INSUFFICIENT";
  if (sampleSize < thresholds.medium) return "LOW";
  if (sampleSize < thresholds.high) return "MEDIUM";
  return "HIGH";
}

export function normalizeJobLabel(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function qualificationState(
  qualification: { status: string; expirationDate: Date | null } | undefined,
  now = new Date()
) {
  if (!qualification) return "MISSING" as const;
  if (qualification.status !== "ACTIVE") return qualification.status;
  if (qualification.expirationDate && qualification.expirationDate < now) return "EXPIRED" as const;
  return "ACTIVE" as const;
}

export function safeRate(numerator: number, denominator: number) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function averageOrNull(total: number, count: number) {
  return count ? Math.round(total / count) : null;
}

export type FitReasonCode =
  | "TECHNICIAN_ACTIVE"
  | "TECHNICIAN_INACTIVE"
  | "SMART_DISPATCH_DISABLED"
  | "SERVICE_TYPE_INELIGIBLE"
  | "REQUIRED_QUALIFICATIONS_MET"
  | "MISSING_REQUIRED_QUALIFICATION"
  | "EXPIRED_REQUIRED_CERTIFICATION"
  | "STRONG_OWNER_SKILL_RATING"
  | "HIGH_JOB_TYPE_EXPERIENCE"
  | "HIGH_FIRST_TIME_COMPLETION"
  | "LOW_CALLBACK_RATE"
  | "PREFERRED_CALL_TYPE"
  | "DEVELOPMENT_CALL_TYPE"
  | "DO_NOT_RECOMMEND_OVERRIDE"
  | "PREVIOUS_CUSTOMER_EXPERIENCE"
  | "PREVIOUS_PROPERTY_EXPERIENCE"
  | "PREVIOUS_EQUIPMENT_EXPERIENCE"
  | "INSUFFICIENT_PERFORMANCE_DATA";

export type FitReason = {
  code: FitReasonCode;
  label: string;
  kind: "POSITIVE" | "NEUTRAL" | "WARNING" | "BLOCKER";
};

export type JobFitInput = {
  technicianActive: boolean;
  smartDispatchEligible: boolean;
  serviceTypeEligible?: boolean;
  requiredQualifications: Array<{
    id: string;
    name: string;
    state: "ACTIVE" | "MISSING" | "EXPIRED" | string;
  }>;
  ownerSkillRating: number | null;
  preference: string | null;
  completedJobs: number;
  confidence: DataConfidence;
  firstTimeCompletionRate: number | null;
  callbackRate: number | null;
  customerVisits: number;
  propertyVisits: number;
  equipmentVisits: number;
  doNotRecommend: boolean;
};

export function evaluateJobFit(input: JobFitInput) {
  const reasons: FitReason[] = [];
  if (!input.technicianActive) {
    reasons.push({ code: "TECHNICIAN_INACTIVE", label: "Technician is inactive", kind: "BLOCKER" });
  } else {
    reasons.push({ code: "TECHNICIAN_ACTIVE", label: "Active team member", kind: "POSITIVE" });
  }
  if (!input.smartDispatchEligible) {
    reasons.push({ code: "SMART_DISPATCH_DISABLED", label: "Smart Dispatch recommendations are disabled", kind: "BLOCKER" });
  }
  if (input.serviceTypeEligible === false) {
    reasons.push({
      code: "SERVICE_TYPE_INELIGIBLE",
      label: "Technician is disabled for this service type",
      kind: "BLOCKER",
    });
  }

  for (const requirement of input.requiredQualifications) {
    if (requirement.state === "MISSING") {
      reasons.push({
        code: "MISSING_REQUIRED_QUALIFICATION",
        label: `Missing required qualification: ${requirement.name}`,
        kind: "BLOCKER",
      });
    } else if (requirement.state === "EXPIRED") {
      reasons.push({
        code: "EXPIRED_REQUIRED_CERTIFICATION",
        label: `Required qualification expired: ${requirement.name}`,
        kind: "BLOCKER",
      });
    }
  }
  if (input.requiredQualifications.length && input.requiredQualifications.every((item) => item.state === "ACTIVE")) {
    reasons.push({
      code: "REQUIRED_QUALIFICATIONS_MET",
      label: "All required qualifications are active",
      kind: "POSITIVE",
    });
  }

  if (input.ownerSkillRating != null && input.ownerSkillRating >= 4) {
    reasons.push({
      code: "STRONG_OWNER_SKILL_RATING",
      label: `${input.ownerSkillRating}/5 owner skill rating`,
      kind: "POSITIVE",
    });
  }
  if (input.completedJobs >= 20) {
    reasons.push({
      code: "HIGH_JOB_TYPE_EXPERIENCE",
      label: `${input.completedJobs} completed calls of this type`,
      kind: "POSITIVE",
    });
  }
  if (input.confidence === "INSUFFICIENT") {
    reasons.push({
      code: "INSUFFICIENT_PERFORMANCE_DATA",
      label: `Early data — ${input.completedJobs} completed job${input.completedJobs === 1 ? "" : "s"}`,
      kind: "NEUTRAL",
    });
  }
  if (input.firstTimeCompletionRate != null && input.firstTimeCompletionRate >= 85) {
    reasons.push({
      code: "HIGH_FIRST_TIME_COMPLETION",
      label: `${input.firstTimeCompletionRate}% first-time completion`,
      kind: "POSITIVE",
    });
  }
  if (input.callbackRate != null && input.callbackRate <= 5) {
    reasons.push({
      code: "LOW_CALLBACK_RATE",
      label: `${input.callbackRate}% callback rate`,
      kind: "POSITIVE",
    });
  }
  if (input.preference === "PREFERRED") {
    reasons.push({ code: "PREFERRED_CALL_TYPE", label: "Preferred call type", kind: "POSITIVE" });
  }
  if (input.preference === "DEVELOPMENT") {
    reasons.push({ code: "DEVELOPMENT_CALL_TYPE", label: "Development call type", kind: "WARNING" });
  }
  if (input.doNotRecommend) {
    reasons.push({
      code: "DO_NOT_RECOMMEND_OVERRIDE",
      label: "Owner marked this call type as do not auto-recommend",
      kind: "WARNING",
    });
  }
  if (input.customerVisits) {
    reasons.push({
      code: "PREVIOUS_CUSTOMER_EXPERIENCE",
      label: `${input.customerVisits} prior visit${input.customerVisits === 1 ? "" : "s"} for this customer`,
      kind: "POSITIVE",
    });
  }
  if (input.propertyVisits) {
    reasons.push({
      code: "PREVIOUS_PROPERTY_EXPERIENCE",
      label: `${input.propertyVisits} prior visit${input.propertyVisits === 1 ? "" : "s"} at this property`,
      kind: "POSITIVE",
    });
  }
  if (input.equipmentVisits) {
    reasons.push({
      code: "PREVIOUS_EQUIPMENT_EXPERIENCE",
      label: `${input.equipmentVisits} prior visit${input.equipmentVisits === 1 ? "" : "s"} on this equipment`,
      kind: "POSITIVE",
    });
  }

  const eligible = !reasons.some((reason) => reason.kind === "BLOCKER");
  return {
    eligible,
    reasons,
    hardConstraints: {
      active: input.technicianActive,
      smartDispatchEligible: input.smartDispatchEligible,
      qualified: !input.requiredQualifications.some((item) => item.state !== "ACTIVE"),
    },
  };
}

export function readiness(input: {
  ratingCount: number;
  qualificationCount: number;
  preferenceCount: number;
  smartDispatchEligible: boolean;
}) {
  const missing: string[] = [];
  if (!input.ratingCount) missing.push("skills evaluation");
  if (!input.qualificationCount) missing.push("qualifications");
  if (!input.preferenceCount) missing.push("preferred or development calls");
  if (!input.smartDispatchEligible) missing.push("Smart Dispatch eligibility");
  return { ready: missing.length === 0, missing };
}
