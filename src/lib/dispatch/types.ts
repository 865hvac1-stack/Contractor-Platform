import type { DispatchIssue } from "@/lib/dispatch/board";
import type { DispatchJobKind } from "@/lib/dispatch/job-type";

export type DispatchCard = {
  id: string;
  customerId: string;
  propertyId?: string;
  jobNumber: string;
  jobType: string | null;
  kind: DispatchJobKind;
  trade: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  description: string | null;
  scheduledStart: Date | string | null;
  scheduledEnd: Date | string | null;
  scheduleLocked: boolean;
  routeOrder: number | null;
  customer: string;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  geocodingStatus?: string | null;
  accessNotes: string | null;
  membership: string | null;
  assigneeIds: string[];
  assignees: string[];
  bookedByContractorYou?: boolean;
  project?: { id: string; projectNumber: string; name: string } | null;
  projectPhase?: { name: string } | null;
  projectVisitPurpose?: string | null;
  partsStatus: "NONE" | "NEEDED" | "RESERVED" | "READY" | "NOT_AVAILABLE";
  customerRequest?: string | null;
  checkedInAt?: Date | string | null;
};

export type DispatchLane = {
  userId: string;
  name: string;
  firstName?: string;
  lastName?: string;
  initials: string;
  role: string;
  jobs: DispatchCard[];
  jobCount: number;
  scheduledMinutes: number;
  nextAvailable: Date | string | null;
  state: "AVAILABLE" | "ON_JOB" | "EN_ROUTE" | "DONE_FOR_DAY" | "AT_RISK";
  projectedDriveMinutes?: number | null;
  locationLabel?: string;
  locationFreshness?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type DispatchBoardData = {
  technicians: DispatchLane[];
  unassigned: DispatchCard[];
  issues: DispatchIssue[];
  metrics: {
    jobs: number;
    completed: number;
    inProgress: number;
    runningLate: number;
    unassigned: number;
    emergency: number;
    availableCapacity: number;
  };
  jobTypes: string[];
  mapsBrowserKey?: string;
  routingConfigured?: boolean;
  geocodingConfigured?: boolean;
};

export type { DispatchIssue };
