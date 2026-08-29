import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(10).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10).max(128),
});

export const companyOnboardingSchema = z.object({
  businessName: z.string().min(1).max(200),
  legalName: z.string().max(200).optional().or(z.literal("")),
  industry: z.enum([
    "HVAC",
    "PLUMBING",
    "ELECTRICAL",
    "ROOFING",
    "POOL_SERVICE",
    "EXCAVATION",
    "CONCRETE",
    "LANDSCAPING",
    "GENERAL_CONTRACTOR",
    "OTHER",
  ]),
  phone: z.string().max(40).optional().or(z.literal("")),
  email: z.string().email().max(255).optional().or(z.literal("")),
  address: z.string().max(300).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(50).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  timezone: z.string().max(100).default("America/New_York"),
  companySize: z.string().max(50).optional().or(z.literal("")),
  serviceArea: z.string().max(300).optional().or(z.literal("")),
});

export const customerSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  businessName: z.string().max(200).optional().or(z.literal("")),
  email: z.string().email().max(255).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  secondaryPhone: z.string().max(40).optional().or(z.literal("")),
  preferredContactMethod: z.enum(["PHONE", "TEXT", "EMAIL", "ANY"]).default("ANY"),
  notes: z.string().max(5000).optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE", "LEAD", "ARCHIVED"]).default("ACTIVE"),
  source: z.string().max(100).optional().or(z.literal("")),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const propertySchema = z.object({
  customerId: z.string().cuid(),
  name: z.string().max(200).optional().or(z.literal("")),
  address: z.string().min(1).max(300),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(50),
  zip: z.string().min(1).max(20),
  propertyType: z.enum(["RESIDENTIAL", "COMMERCIAL", "MULTI_FAMILY", "OTHER"]).default("RESIDENTIAL"),
  accessNotes: z.string().max(2000).optional().or(z.literal("")),
  gateCodeNotes: z.string().max(500).optional().or(z.literal("")),
  isPrimary: z.boolean().optional(),
});

export const jobSchema = z.object({
  customerId: z.string().cuid(),
  propertyId: z.string().cuid(),
  jobType: z.string().max(100).optional().or(z.literal("")),
  trade: z
    .enum([
      "HVAC",
      "PLUMBING",
      "ELECTRICAL",
      "ROOFING",
      "POOL_SERVICE",
      "EXCAVATION",
      "CONCRETE",
      "LANDSCAPING",
      "GENERAL_CONTRACTOR",
      "OTHER",
    ])
    .optional(),
  status: z
    .enum([
      "NEW",
      "UNSCHEDULED",
      "SCHEDULED",
      "DISPATCHED",
      "IN_PROGRESS",
      "ON_HOLD",
      "COMPLETED",
      "CANCELED",
    ])
    .optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  source: z.string().max(100).optional().or(z.literal("")),
  description: z.string().max(5000).optional().or(z.literal("")),
  internalNotes: z.string().max(5000).optional().or(z.literal("")),
  customerNotes: z.string().max(5000).optional().or(z.literal("")),
  scheduledStart: z.string().datetime().optional().or(z.literal("")),
  scheduledEnd: z.string().datetime().optional().or(z.literal("")),
  assigneeIds: z.array(z.string().cuid()).optional(),
});

export const lineItemSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().or(z.literal("")),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPriceCents: z.coerce.number().int().min(0).max(100_000_000),
  costCents: z.coerce.number().int().min(0).max(100_000_000).optional().nullable(),
  taxable: z.boolean().default(true),
  category: z.string().max(100).optional().or(z.literal("")),
});

export const estimateSchema = z.object({
  customerId: z.string().cuid(),
  propertyId: z.string().cuid().optional().or(z.literal("")),
  jobId: z.string().cuid().optional().or(z.literal("")),
  status: z
    .enum(["DRAFT", "SENT", "VIEWED", "APPROVED", "DECLINED", "EXPIRED", "CANCELED"])
    .optional(),
  expirationDate: z.string().datetime().optional().or(z.literal("")),
  taxCents: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(5000).optional().or(z.literal("")),
  lineItems: z.array(lineItemSchema).min(1),
});

export const invoiceSchema = z.object({
  customerId: z.string().cuid(),
  propertyId: z.string().cuid().optional().or(z.literal("")),
  jobId: z.string().cuid().optional().or(z.literal("")),
  status: z.enum(["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"]).optional(),
  dueDate: z.string().datetime().optional().or(z.literal("")),
  taxCents: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(5000).optional().or(z.literal("")),
  lineItems: z.array(lineItemSchema.omit({ costCents: true })).min(1),
});

export const expenseSchema = z.object({
  vendor: z.string().max(200).optional().or(z.literal("")),
  date: z.string().min(1),
  amountCents: z.coerce.number().int().min(0).max(100_000_000),
  taxCents: z.coerce.number().int().min(0).default(0),
  category: z.enum([
    "MATERIALS",
    "EQUIPMENT",
    "FUEL",
    "SUBCONTRACTOR",
    "PERMITS",
    "TOOLS",
    "VEHICLE",
    "OFFICE",
    "ADVERTISING",
    "INSURANCE",
    "OTHER",
  ]),
  description: z.string().max(2000).optional().or(z.literal("")),
  paymentMethod: z.enum(["CASH", "CHECK", "CREDIT_CARD", "ACH", "OTHER"]).optional(),
  jobId: z.string().cuid().optional().or(z.literal("")),
  customerId: z.string().cuid().optional().or(z.literal("")),
  receiptId: z.string().cuid().optional().or(z.literal("")),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "POSTED"]).optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum([
    "ADMIN",
    "OFFICE",
    "DISPATCHER",
    "SALES",
    "TECHNICIAN",
    "INSTALLER",
    "MANAGER",
    "COMPANY_OWNER",
  ]),
  temporaryPassword: z.string().min(10).max(128),
});
