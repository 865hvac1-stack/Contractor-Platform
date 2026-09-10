import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { getCompanyConnection } from "@/lib/integrations/store";
import { QUICKBOOKS_PROVIDER_KEY } from "@/lib/quickbooks/config";
import { getQuickBooksSettings, loadQuickBooksTransport } from "@/lib/quickbooks/connection";
import { previewQuickBooksSync } from "@/lib/quickbooks/preview";
import { qboListExpenseAccounts, qboListItems } from "@/lib/quickbooks/client";
import { syncStartOptionFromDate } from "@/lib/quickbooks/dates";
import { INVOICE_TRIGGER_COPY } from "@/lib/quickbooks/status";
import {
  refreshQuickBooksCompanyAction,
  saveQuickBooksItemMappingsAction,
  saveQuickBooksWizardAction,
} from "@/server/actions/quickbooks";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "1", title: "Verify company" },
  { key: "2", title: "Sync start date" },
  { key: "3", title: "Customer matching" },
  { key: "4", title: "Products / Services" },
  { key: "5", title: "Accounting preferences" },
  { key: "6", title: "Preview records" },
  { key: "7", title: "Confirm" },
] as const;

export default async function QuickBooksSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const ctx = await requirePermission("accounting:manage");
  const { step: rawStep } = await searchParams;
  const step = STEPS.some((item) => item.key === rawStep) ? rawStep! : "1";
  const connection = await getCompanyConnection(ctx.company.id, QUICKBOOKS_PROVIDER_KEY);
  if (!connection?.externalAccountId) redirect("/settings/quickbooks");
  const [settings, preview, serviceTypes, mappings] = await Promise.all([
    getQuickBooksSettings(ctx.company.id),
    previewQuickBooksSync(prisma, ctx.company.id),
    prisma.serviceType.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.quickBooksMapping.findMany({
      where: { companyId: ctx.company.id, entityType: { in: ["SERVICE_ITEM", "DEFAULT_ITEM", "EXPENSE_ACCOUNT"] } },
    }),
  ]);
  const loaded = await loadQuickBooksTransport(ctx.company.id);
  const items = loaded.ok ? await qboListItems(loaded.transport) : [];
  const accounts = loaded.ok ? await qboListExpenseAccounts(loaded.transport) : [];
  const defaultItem = mappings.find((row) => row.entityType === "DEFAULT_ITEM")?.quickbooksId ?? "";
  const expenseAccount = mappings.find((row) => row.entityType === "EXPENSE_ACCOUNT")?.quickbooksId ?? "";
  const startOption = syncStartOptionFromDate(settings.syncStartDate);
  const next = String(Math.min(Number(step) + 1, 7));
  const prev = String(Math.max(Number(step) - 1, 1));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/settings/quickbooks" className="text-sm text-[var(--muted-foreground)]">
          ← QuickBooks
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Initial sync setup</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Safe mode first. Scan and preview before anything is pushed. Historical imports stay here.
        </p>
      </div>

      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((item) => (
          <li key={item.key}>
            <Link
              href={`/settings/quickbooks/setup?step=${item.key}`}
              className={cn(
                "rounded-full px-3 py-1",
                item.key === step ? "bg-[var(--cy-navy)] text-white" : "bg-white border border-[var(--border)]"
              )}
            >
              {item.key}. {item.title}
            </Link>
          </li>
        ))}
      </ol>

      {step === "1" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="font-medium">Verify QuickBooks company</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {settings.qboCompanyName
              ? `Verified company: ${settings.qboCompanyName}`
              : "We have not verified a QuickBooks company name yet."}
          </p>
          <ActionForm action={refreshQuickBooksCompanyAction} className="mt-4">
            <Button type="submit" size="sm">
              Verify now
            </Button>
          </ActionForm>
        </section>
      ) : null}

      {step === "2" ? (
        <ActionForm action={saveQuickBooksWizardAction} className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="font-medium">Choose a sync start date</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Default is the start of this month. Records before that date stay in ContractorYou.
          </p>
          <label className="flex gap-2 text-sm">
            <input type="radio" name="syncStartOption" value="today" defaultChecked={startOption === "today"} />
            Today
          </label>
          <label className="flex gap-2 text-sm">
            <input type="radio" name="syncStartOption" value="month" defaultChecked={startOption === "month"} />
            Start of current month
          </label>
          <label className="flex gap-2 text-sm">
            <input type="radio" name="syncStartOption" value="year" defaultChecked={startOption === "year"} />
            Start of current year
          </label>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="radio" name="syncStartOption" value="custom" defaultChecked={startOption === "custom"} />
            Custom date
            <Input
              type="date"
              name="customDate"
              defaultValue={settings.syncStartDate ? settings.syncStartDate.toISOString().slice(0, 10) : ""}
              className="w-44"
            />
          </label>
          <input type="hidden" name="invoiceSyncTrigger" value={settings.invoiceSyncTrigger} />
          <Button type="submit">Save date</Button>
        </ActionForm>
      ) : null}

      {step === "3" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="font-medium">Customer matching preview</h2>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {preview.customersAvailable} customers in ContractorYou. {preview.customersLinked} already linked.{" "}
            {preview.customersNeedReview} need review. We never match on name alone.
          </p>
          <Link href="/settings/quickbooks/manage#review" className="mt-3 inline-block text-sm text-[var(--cy-orange)]">
            Review matches →
          </Link>
        </section>
      ) : null}

      {step === "4" || step === "5" ? (
        <ActionForm action={saveQuickBooksItemMappingsAction} className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="font-medium">{step === "4" ? "Products / Services mapping" : "Accounting preferences"}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            ContractorYou service types are not QuickBooks items. Map them, or invoices stay in Needs mapping.
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              We could not load QuickBooks items yet. You can still paste a Product/Service ID.
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="defaultItemId">Default QuickBooks Product/Service</Label>
            {items.length ? (
              <select id="defaultItemId" name="defaultItemId" defaultValue={defaultItem} className="h-10 w-full rounded-lg border border-input px-3 text-sm">
                <option value="">Choose one</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input id="defaultItemId" name="defaultItemId" defaultValue={defaultItem} placeholder="QuickBooks item ID" />
            )}
          </div>
          {serviceTypes.map((service) => {
            const mapped = mappings.find((row) => row.entityType === "SERVICE_ITEM" && row.internalId === service.id)?.quickbooksId ?? "";
            return (
              <div key={service.id} className="space-y-2">
                <Label htmlFor={`serviceItem:${service.id}`}>{service.name}</Label>
                {items.length ? (
                  <select
                    id={`serviceItem:${service.id}`}
                    name={`serviceItem:${service.id}`}
                    defaultValue={mapped}
                    className="h-10 w-full rounded-lg border border-input px-3 text-sm"
                  >
                    <option value="">Use default</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input name={`serviceItem:${service.id}`} defaultValue={mapped} placeholder="QuickBooks item ID" />
                )}
              </div>
            );
          })}
          {step === "5" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="expenseAccountId">Default expense account</Label>
                {accounts.length ? (
                  <select
                    id="expenseAccountId"
                    name="expenseAccountId"
                    defaultValue={expenseAccount}
                    className="h-10 w-full rounded-lg border border-input px-3 text-sm"
                  >
                    <option value="">Choose one</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input id="expenseAccountId" name="expenseAccountId" defaultValue={expenseAccount} placeholder="QuickBooks expense account ID" />
                )}
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Invoice push after activation</legend>
                {INVOICE_TRIGGER_COPY.map((option) => (
                  <label key={option.value} className="flex gap-2 text-sm">
                    <input
                      type="radio"
                      name="invoiceSyncTrigger"
                      value={option.value}
                      defaultChecked={settings.invoiceSyncTrigger === option.value}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}
          <Button type="submit">Save mappings</Button>
        </ActionForm>
      ) : null}

      {step === "5" ? (
        <ActionForm action={saveQuickBooksWizardAction} className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <input type="hidden" name="syncStartOption" value={startOption} />
          <input
            type="hidden"
            name="customDate"
            value={settings.syncStartDate ? settings.syncStartDate.toISOString().slice(0, 10) : ""}
          />
          <input type="hidden" name="invoiceSyncTrigger" value={settings.invoiceSyncTrigger} />
          <Button type="submit" variant="outline" size="sm">
            Save preferences
          </Button>
        </ActionForm>
      ) : null}

      {step === "6" ? (
        <section className="rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="font-medium">Preview records</h2>
          <ul className="mt-3 space-y-1 text-sm">
            <li>{preview.customersAvailable} customers available to link</li>
            <li>{preview.invoicesEligible} invoices eligible after the start date</li>
            <li>{preview.paymentsEligible} payments eligible</li>
            <li>{preview.expensesEligible} approved expenses eligible</li>
            <li>{preview.conflicts} conflicts / need review</li>
            <li>{preview.historicalProtected} historical records protected from automatic push</li>
            <li>{preview.beforeStartDate} records before the start date</li>
          </ul>
        </section>
      ) : null}

      {step === "7" ? (
        <ActionForm action={saveQuickBooksWizardAction} className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6">
          <h2 className="font-medium">Confirm</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Confirming turns on automatic sync for new eligible records after{" "}
            {settings.syncStartDate ? settings.syncStartDate.toLocaleDateString() : "the start date you chose"}. It does
            not flood QuickBooks with imported history.
          </p>
          <input type="hidden" name="syncStartOption" value={startOption} />
          <input
            type="hidden"
            name="customDate"
            value={settings.syncStartDate ? settings.syncStartDate.toISOString().slice(0, 10) : ""}
          />
          <input type="hidden" name="invoiceSyncTrigger" value={settings.invoiceSyncTrigger} />
          <input type="hidden" name="activate" value="yes" />
          <Button type="submit">Activate automatic sync</Button>
        </ActionForm>
      ) : null}

      <div className="flex justify-between">
        {Number(step) > 1 ? (
          <Link href={`/settings/quickbooks/setup?step=${prev}`} className={cn(buttonVariants({ variant: "outline" }))}>
            Back
          </Link>
        ) : (
          <span />
        )}
        {Number(step) < 7 ? (
          <Link href={`/settings/quickbooks/setup?step=${next}`} className={cn(buttonVariants())}>
            Continue
          </Link>
        ) : (
          <Link href="/settings/quickbooks/manage" className="text-sm text-[var(--cy-orange)]">
            Open Sync Center →
          </Link>
        )}
      </div>
    </div>
  );
}
