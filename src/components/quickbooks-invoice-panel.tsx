import { format } from "date-fns";
import { can } from "@/lib/permissions";
import type { CompanyRole, QuickBooksSyncStatus } from "@prisma/client";
import { syncInvoiceToQuickBooksAction, syncPaymentToQuickBooksAction } from "@/server/actions/quickbooks";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";

export function QuickBooksInvoicePanel({
  role,
  invoiceId,
  importMode,
  mapping,
  lastEvent,
  payments,
}: {
  role: CompanyRole;
  invoiceId: string;
  importMode: string;
  mapping: { quickbooksId: string; lastSyncedAt: Date | null; status: QuickBooksSyncStatus } | null;
  lastEvent: { status: QuickBooksSyncStatus; errorMessage: string | null; createdAt: Date } | null;
  payments: { id: string; amountLabel: string; mapping: { quickbooksId: string } | null }[];
}) {
  const canSync = can(role, "accounting:manage");
  const failed = lastEvent?.status === "FAILED" || lastEvent?.status === "REAUTH_REQUIRED";
  const historical = importMode === "HISTORICAL";

  return (
    <section className="space-y-4 rounded-xl border border-[var(--border)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">QuickBooks</h2>
          {mapping ? (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Synced · QB Invoice #{mapping.quickbooksId}
              {mapping.lastSyncedAt ? ` · Last synced ${format(mapping.lastSyncedAt, "MMM d 'at' h:mm a")}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {historical
                ? "Imported history stays here until you choose Sync to QuickBooks."
                : "Not synced. Connect QuickBooks to sync invoices."}
            </p>
          )}
        </div>
        {mapping ? <StatusBadge status="SYNCED" /> : failed ? <StatusBadge status="SYNC FAILED" /> : <StatusBadge status="NOT SYNCED" />}
      </div>
      {failed && lastEvent?.errorMessage ? (
        <p className="text-sm text-rose-700">See error: we could not finish that sync. Reconnect if QuickBooks asks you to sign in again.</p>
      ) : null}
      {canSync ? (
        <ActionForm action={syncInvoiceToQuickBooksAction} successMessage="Invoice sent to QuickBooks.">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <Button type="submit" size="sm" variant={mapping ? "outline" : "default"}>
            {mapping ? "Sync again" : "Sync to QuickBooks"}
          </Button>
        </ActionForm>
      ) : null}
      {payments.length > 0 ? (
        <ul className="space-y-2 border-t border-[var(--border)] pt-3 text-sm">
          {payments.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Payment {payment.amountLabel}
                {payment.mapping ? ` · QB ${payment.mapping.quickbooksId}` : " · not in QuickBooks"}
              </span>
              {canSync && !payment.mapping ? (
                <ActionForm action={syncPaymentToQuickBooksAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Record in QuickBooks
                  </Button>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
