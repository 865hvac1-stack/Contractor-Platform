import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/integrations/env";
import {
  createLandingPageAction,
  createTrackingNumberAction,
  createWebsiteFormAction,
} from "@/server/actions/website";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default async function WebsiteMarketingPage() {
  const ctx = await requirePermission("marketing:view");
  const canManage = can(ctx.role, "marketing:manage");
  const [forms, pages, numbers] = await Promise.all([
    prisma.websiteForm.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.landingPage.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.trackingNumber.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-[var(--cy-navy)]">Website</h1>
        <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
          Hosted forms and landing pages create real ContractorYou leads with UTM first-touch and
          last-touch. No provider approval required.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {canManage ? (
          <ActionForm
            action={createWebsiteFormAction}
            className="space-y-3 rounded-2xl border bg-white p-5"
            successMessage="Form created. Use the hosted URL and embed code below."
          >
            <h2 className="font-semibold">Create a lead form</h2>
            <Input name="name" required placeholder="Request service" />
            <Button type="submit">Create form</Button>
          </ActionForm>
        ) : null}

        {canManage ? (
          <ActionForm action={createLandingPageAction} className="space-y-3 rounded-2xl border bg-white p-5">
            <h2 className="font-semibold">Create a landing page</h2>
            <Input name="name" required placeholder="Spring tune-up" />
            <Input name="headline" required placeholder="Your AC, ready for summer" />
            <Textarea name="body" rows={3} placeholder="What the visitor should know" />
            <select name="formId" className="h-10 w-full rounded-lg border px-2 text-sm">
              <option value="">No form</option>
              {forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
            <Button type="submit">Publish page</Button>
          </ActionForm>
        ) : null}
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-[var(--cy-navy)]">Forms</h2>
        {forms.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No forms yet.</p>
        ) : (
          <ul className="space-y-3">
            {forms.map((form) => {
              const url = `${appUrl()}/f/${form.id}`;
              return (
                <li key={form.id} className="rounded-2xl border bg-white p-4 text-sm">
                  <p className="font-medium">{form.name}</p>
                  <p className="mt-1 break-all text-[var(--muted-foreground)]">{url}</p>
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--cy-gray)] p-3 text-xs">
{`<iframe src="${url}" title="${form.name}" style="width:100%;min-height:520px;border:0"></iframe>`}
                  </pre>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-[var(--cy-navy)]">Landing pages</h2>
        {pages.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No pages yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {pages.map((page) => (
              <li key={page.id}>
                <a href={`/p/${page.id}`} className="underline">
                  {page.name}
                </a>{" "}
                · {page.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border bg-white p-5">
        <h2 className="font-semibold">Tracking numbers</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Map a number to a source. ContractorYou will not provision a real Twilio number until
          credentials exist.
        </p>
        {canManage ? (
          <ActionForm action={createTrackingNumberAction} className="grid gap-3 sm:grid-cols-3">
            <Input name="phoneNumber" required placeholder="(865) 555-0100" />
            <Input name="source" placeholder="GOOGLE_ADS" />
            <Input name="campaign" placeholder="Spring AC" />
            <Button type="submit">Save mapping</Button>
          </ActionForm>
        ) : null}
        <ul className="text-sm">
          {numbers.map((number) => (
            <li key={number.id}>
              {number.phoneNumber} → {number.source}
              {number.campaign ? ` / ${number.campaign}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
