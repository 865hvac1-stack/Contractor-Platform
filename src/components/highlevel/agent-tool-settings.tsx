"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { generateAgentToolKeyAction, revokeAgentToolKeyAction } from "@/server/actions/agent-tools";

export function AgentToolSettings({
  keys,
  recentCalls,
}: {
  keys: Array<{ id: string; lastFour: string; lastUsedAt: string | null; createdAt: string }>;
  recentCalls: Array<{
    id: string;
    tool: string;
    success: boolean;
    errorCode: string | null;
    customerId: string | null;
    jobId: string | null;
    createdAt: string;
  }>;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-4">
      <div>
        <h2 className="font-medium">HighLevel Agent Studio tools</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Regina talks. ContractorYou is the source of truth for availability and booking. After a real booking
          commits, ContractorYou sends the confirmation SMS. Regina must never tell a customer they are scheduled
          unless booking_confirmed is true.
        </p>
      </div>
      <ActionForm action={generateAgentToolKeyAction}>
        <Button type="submit">Generate Agent Tool key</Button>
      </ActionForm>
      {keys.length ? (
        <ul className="space-y-2 text-sm">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
              <span>
                Key ending in <span className="font-mono">{key.lastFour}</span>
                {key.lastUsedAt ? ` · last used ${key.lastUsedAt}` : " · not used yet"}
              </span>
              <ActionForm action={revokeAgentToolKeyAction}>
                <input type="hidden" name="credentialId" value={key.id} />
                <Button type="submit" variant="outline" size="sm">
                  Revoke
                </Button>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">No active Agent Tool keys.</p>
      )}
      <div>
        <h3 className="text-sm font-medium">Recent tool calls</h3>
        {recentCalls.length ? (
          <ul className="mt-2 space-y-1 text-xs text-[var(--muted-foreground)]">
            {recentCalls.map((call) => (
              <li key={call.id}>
                {call.createdAt} · {call.tool} · {call.success ? "ok" : call.errorCode || "failed"}
                {call.jobId ? ` · job ${call.jobId}` : ""}
                {call.customerId ? ` · customer ${call.customerId}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">No Agent Studio tool calls yet.</p>
        )}
      </div>
    </section>
  );
}
