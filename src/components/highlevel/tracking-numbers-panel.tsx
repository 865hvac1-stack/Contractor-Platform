import { prisma } from "@/lib/db";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HIGHLEVEL_PROVIDER_KEY, SMS_DEFAULT_CHANNEL } from "@/lib/highlevel/config";
import { isHighLevelConnected } from "@/lib/highlevel/connection";
import { resolveApprovedSenderNumber } from "@/lib/highlevel/phone-numbers";
import {
  mapTrackingNumberSourceAction,
  purchaseHighLevelNumberAction,
  searchHighLevelAvailableNumbersAction,
  setDefaultSmsSenderAction,
  syncHighLevelNumbersAction,
} from "@/server/actions/highlevel";

const SOURCES = [
  "Google LSA Test",
  "GOOGLE_LSA",
  "GOOGLE_ADS",
  "WEBSITE",
  "FACEBOOK",
  "PHONE",
  "SMS",
  "REFERRAL",
  "HIGHLEVEL",
];

export async function TrackingNumbersPanel({
  companyId,
  canManage,
}: {
  companyId: string;
  canManage: boolean;
}) {
  const [numbers, connected, sender] = await Promise.all([
    prisma.trackingNumber.findMany({ where: { companyId }, orderBy: { updatedAt: "desc" } }),
    isHighLevelConnected(prisma, companyId),
    resolveApprovedSenderNumber(prisma, companyId),
  ]);

  return (
    <section className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Tracking numbers
        </p>
        <h2 className="mt-1 text-lg font-semibold text-[var(--cy-navy)]">HighLevel location numbers</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted-foreground)]">
          Sync the location&apos;s active LC Phone numbers, map each one to a source such as Google LSA Test,
          and choose the approved SMS sender. ContractorYou never picks a from-number at random. Purchase is
          billable and never runs during tests.
        </p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--cy-gray)]/50 px-4 py-3 text-sm">
        Approved SMS sender:{" "}
        <span className="font-medium text-[var(--cy-navy)]">{sender?.phoneNumber ?? "Not set"}</span>
        {connected ? " · HighLevel connected" : " · Connect HighLevel first"}
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <ActionForm action={syncHighLevelNumbersAction}>
            <Button type="submit">{connected ? "Sync HighLevel numbers" : "HighLevel not connected"}</Button>
          </ActionForm>
        </div>
      ) : null}

      {numbers.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No numbers stored yet. Connect the location and sync, or map a number manually below.
        </p>
      ) : (
        <ul className="space-y-3">
          {numbers.map((number) => (
            <li key={number.id} className="rounded-2xl border border-[var(--border)] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-[var(--cy-navy)]">{number.phoneNumber}</p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {number.source}
                    {number.campaign ? ` · ${number.campaign}` : ""}
                    {number.provider === HIGHLEVEL_PROVIDER_KEY ? " · HighLevel" : ""}
                    {number.channel === SMS_DEFAULT_CHANNEL ? " · Approved SMS sender" : ""}
                  </p>
                </div>
                {canManage ? (
                  <ActionForm action={setDefaultSmsSenderAction}>
                    <input type="hidden" name="trackingNumberId" value={number.id} />
                    <Button type="submit" variant="outline" size="sm">
                      Use as SMS sender
                    </Button>
                  </ActionForm>
                ) : null}
              </div>
              {canManage ? (
                <ActionForm action={mapTrackingNumberSourceAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input type="hidden" name="trackingNumberId" value={number.id} />
                  <select name="source" defaultValue={number.source} className="h-10 rounded-lg border px-2 text-sm">
                    {SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </select>
                  <Input name="campaign" defaultValue={number.campaign ?? ""} placeholder="Campaign / friendly name" />
                  <Button type="submit" variant="outline">
                    Save mapping
                  </Button>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm
            action={searchHighLevelAvailableNumbersAction}
            className="space-y-3 rounded-2xl border border-dashed border-[var(--border)] bg-white p-4"
          >
            <h3 className="font-medium text-[var(--cy-navy)]">Search available numbers</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              Read-only LC Phone inventory search. Does not buy anything.
            </p>
            <Input name="areaCode" placeholder="Area code (865)" />
            <Button type="submit" variant="outline">
              Search inventory
            </Button>
          </ActionForm>
          <ActionForm
            action={purchaseHighLevelNumberAction}
            className="space-y-3 rounded-2xl border border-dashed border-[var(--border)] bg-white p-4"
          >
            <h3 className="font-medium text-[var(--cy-navy)]">Purchase a number</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              Billable HighLevel action. Type PURCHASE to confirm. Never used by automated tests.
            </p>
            <Input name="phoneNumber" placeholder="+18655550100" />
            <Input name="confirmPurchase" placeholder="Type PURCHASE" />
            <Button type="submit" variant="outline">
              Purchase number
            </Button>
          </ActionForm>
        </div>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm">
        <h3 className="font-medium text-[var(--cy-navy)]">Summit / 865 human proof</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
          <li>Connect this company to its own HighLevel location — never reuse 865 HVAC&apos;s location on Summit.</li>
          <li>Sync active numbers, map the Summit test line to Google LSA Test, then call that number from a real phone.</li>
          <li>The InboundMessage CALL webhook should create the Communications row, Call record, and lead.</li>
          <li>Set the approved SMS sender, open a customer, send a company text, then reply inbound.</li>
        </ol>
      </section>
    </section>
  );
}
