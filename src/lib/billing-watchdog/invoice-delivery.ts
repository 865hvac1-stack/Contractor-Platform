import type { InvoiceStatus, Prisma } from "@prisma/client";

export type InvoiceDeliveryState =
  | "DRAFT"
  | "READY"
  | "SENT"
  | "DELIVERED"
  | "DELIVERY_FAILED"
  | "PAID"
  | "PARTIALLY_PAID"
  | "OVERDUE"
  | "VOID";

export function invoiceDeliveryWrite(status: InvoiceStatus, now = new Date()): Prisma.InvoiceUpdateInput {
  if (status === "SENT") {
    return { status, sentAt: now, deliveryStatus: "SENT" };
  }
  if (status === "VOID") {
    return { status, deliveryStatus: "NONE" };
  }
  return { status };
}

export function presentInvoiceDelivery(input: {
  status: InvoiceStatus | string;
  sentAt?: Date | null;
  deliveryStatus?: string | null;
  dueDate?: Date | null;
  balanceCents?: number;
  asOf?: Date;
}): { label: string; state: InvoiceDeliveryState } {
  if (input.status === "VOID") return { label: "Void", state: "VOID" };
  if (input.deliveryStatus === "FAILED") return { label: "Delivery failed", state: "DELIVERY_FAILED" };
  if (input.deliveryStatus === "DELIVERED") return { label: "Delivered", state: "DELIVERED" };
  if (input.status === "PAID") return { label: "Paid", state: "PAID" };
  if (input.status === "PARTIALLY_PAID") return { label: "Partially paid", state: "PARTIALLY_PAID" };
  if (
    (input.status === "OVERDUE" ||
      (input.dueDate && input.balanceCents && input.balanceCents > 0 && input.dueDate < (input.asOf ?? new Date()))) &&
    (input.sentAt || input.status === "SENT" || input.status === "OVERDUE")
  ) {
    return { label: "Overdue", state: "OVERDUE" };
  }
  if (input.sentAt || input.status === "SENT") return { label: "Sent", state: "SENT" };
  if (input.status === "DRAFT") return { label: "Draft", state: "DRAFT" };
  return { label: "Ready", state: "READY" };
}
