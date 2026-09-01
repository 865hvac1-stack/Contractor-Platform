import type { DispatchIssue } from "@/lib/dispatch/board";
import type { DispatchJobKind } from "@/lib/dispatch/job-type";

export type DispatchCard = {
  id: string;
  customerId: string;
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
  customer: string;
  phone: string | null;
  email: string | null;
  address: string;
  city: string;
  accessNotes: string | null;
  membership: string | null;
  assigneeIds: string[];
  assignees: string[];
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
  state: "AVAILABLE" | "ON_JOB" | "EN_ROUTE" | "DONE_FOR_DAY";
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
  };
  jobTypes: string[];
};

export type { DispatchIssue };
