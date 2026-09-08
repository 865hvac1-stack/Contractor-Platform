"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { convertLeadToCustomerAction, linkLeadToCustomerAction } from "@/server/actions/leads";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ConvertState = {
  ok: boolean;
  error?: string;
  matchId?: string;
  matchName?: string;
};

type SearchHit = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};

export function ConvertCustomerPanel({
  leadId,
  firstName,
  lastName,
  phone,
  email,
  match,
}: {
  leadId: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  match?: { id: string; name: string; matchedOn: string } | null;
}) {
  const router = useRouter();
  const [convertState, convertAction, converting] = useActionState(convertLeadToCustomerAction, null);
  const [linkState, linkAction, linking] = useActionState(linkLeadToCustomerAction, null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(match?.id ?? "");

  useEffect(() => {
    if (convertState?.ok || linkState?.ok) router.refresh();
  }, [convertState, linkState, router]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`);
        const data = (await response.json()) as { items?: SearchHit[] };
        setHits(data.items ?? []);
      } catch {
        setHits([]);
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const blockingMatch = !convertState?.ok && (convertState?.matchId || match?.id);
  const shownMatchId = convertState?.matchId || match?.id;
  const shownMatchName = convertState?.matchName || match?.name;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
      <h2 className="font-semibold text-[var(--cy-navy)]">Convert to customer</h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        Review the verified lead details, search for an existing customer, then link or create. We will
        not silently merge records.
      </p>

      {shownMatchId ? (
        <div className="mt-3 rounded-xl bg-[var(--cy-gray)] px-3 py-3 text-sm">
          <p className="font-medium text-[var(--cy-navy)]">Possible existing customer</p>
          <p className="mt-1">
            {shownMatchName}{" "}
            <Link href={`/customers/${shownMatchId}`} className="underline-offset-4 hover:underline">
              View
            </Link>
          </p>
          <form action={linkAction} className="mt-3">
            <input type="hidden" name="leadId" value={leadId} />
            <input type="hidden" name="customerId" value={shownMatchId} />
            <Button type="submit" disabled={linking}>
              Link existing customer
            </Button>
          </form>
        </div>
      ) : null}

      <form action={linkAction} className="mt-4 space-y-3">
        <input type="hidden" name="leadId" value={leadId} />
        <Label htmlFor="customer-search">Search existing customers</Label>
        <Input
          id="customer-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, phone, or email"
        />
        {hits.length > 0 ? (
          <ul className="space-y-1 rounded-lg border border-[var(--border)] p-2">
            {hits.map((hit) => (
              <li key={hit.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--cy-gray)]">
                  <input
                    type="radio"
                    name="selectedCustomer"
                    value={hit.id}
                    checked={selected === hit.id}
                    onChange={() => setSelected(hit.id)}
                  />
                  <span>
                    <span className="font-medium text-[var(--cy-navy)]">{hit.name}</span>
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {[hit.phone, hit.email].filter(Boolean).join(" · ") || "No contact"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {selected ? <input type="hidden" name="customerId" value={selected} /> : null}
        <Button type="submit" variant="outline" disabled={!selected || linking}>
          Link selected customer
        </Button>
        {linkState && !linkState.ok ? <p className="text-sm text-rose-700">{linkState.error}</p> : null}
      </form>

      <form action={convertAction} className="mt-6 space-y-3 border-t border-[var(--border)] pt-4">
        <input type="hidden" name="leadId" value={leadId} />
        {blockingMatch ? <input type="hidden" name="confirmCreate" value="1" /> : null}
        <p className="text-sm font-medium text-[var(--cy-navy)]">Create new customer</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" name="firstName" defaultValue={firstName} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" name="lastName" defaultValue={lastName} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={phone ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={email ?? ""} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="businessName">Company</Label>
            <Input id="businessName" name="businessName" />
          </div>
        </div>
        <Button type="submit" disabled={converting} className={cn(buttonVariants())}>
          {blockingMatch ? "Create anyway" : "Create customer"}
        </Button>
        {convertState && !convertState.ok ? (
          <p className="text-sm text-rose-700">{convertState.error}</p>
        ) : null}
      </form>
    </section>
  );
}
