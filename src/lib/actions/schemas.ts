import { z } from "zod";

const idList = z.array(z.string().min(1).max(64)).max(50).optional();

export const emptyInput = z.object({}).passthrough();

export const customerSearchInput = z.object({
  query: z.string().trim().max(120).optional(),
  recordIds: idList,
});

export const jobSearchInput = z.object({
  query: z.string().trim().max(120).optional(),
  unassigned: z.boolean().optional(),
  when: z.enum(["today", "tomorrow", "any"]).optional(),
  recordIds: idList,
});

export const identifyFollowupsInput = z.object({
  minCents: z.number().int().min(0).max(100_000_000).optional(),
  minDays: z.number().int().min(0).max(365).optional(),
  recordIds: idList,
});

export const identifyOverdueInput = z.object({
  minDays: z.number().int().min(0).max(365).optional(),
  recordIds: idList,
});

export const identifyRenewalsInput = z.object({
  withinDays: z.number().int().min(1).max(120).optional(),
  recordIds: idList,
});

export const reportInput = z.object({
  period: z.enum(["today", "week", "month", "last_7", "last_30"]).optional(),
});

export const draftFromIdsInput = z.object({
  recordIds: idList,
  requestId: z.string().min(1).max(64).optional(),
  purpose: z.string().trim().max(400).optional(),
});

export const socialDraftInput = z.object({
  topic: z.string().trim().max(200).optional(),
  channel: z.enum(["FACEBOOK", "INSTAGRAM", "GOOGLE_BUSINESS_PROFILE"]).optional(),
  scheduledAt: z.string().optional(),
  body: z.string().trim().max(2000).optional(),
});

export const proposeAssignmentInput = z.object({
  recordIds: idList,
  when: z.enum(["today", "tomorrow", "any"]).optional(),
});

export const taskPrepareInput = z.object({
  title: z.string().trim().max(200).optional(),
  assigneeQuery: z.string().trim().max(80).optional(),
  assignedToUserId: z.string().max(64).optional(),
  dueAt: z.string().optional(),
  recordIds: idList,
  recordType: z.enum(["ESTIMATE", "INVOICE", "JOB", "CUSTOMER", "MEMBERSHIP"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export const sendFromRequestInput = z.object({
  requestId: z.string().min(1).max(64).optional(),
  recordIds: idList,
});

export const reviewIdentifyInput = z.object({
  withinDays: z.number().int().min(1).max(30).optional(),
});
