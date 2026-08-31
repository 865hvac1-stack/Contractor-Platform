"use server";

import { approveEstimateOptionAction } from "@/server/actions/estimate-options";
import { startPublicInvoiceCheckoutAction } from "@/server/actions/payments";
import type { ActionResult } from "@/server/actions/auth";

export async function publicApproveEstimateAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return approveEstimateOptionAction({
    estimateId: String(formData.get("estimateId") || ""),
    optionId: String(formData.get("optionId") || "") || null,
    method: "CUSTOMER_PORTAL",
    publicToken: String(formData.get("token") || ""),
  });
}

export async function publicPayInvoiceAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return startPublicInvoiceCheckoutAction(String(formData.get("token") || ""));
}
