"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { generateAgentToolKeyAction, revokeAgentToolKeyAction } from "@/server/actions/agent-tools";

export function AgentToolSettings({
  keys,
  recentCalls,
  schedulingStatus,
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
  schedulingStatus?: {
    orchestration: string;
    activeSessions: number;
    lastActionAt: string | null;
    lastActionTool: string | null;
    lastActionOk: boolean | null;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
  };
}) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-4">
      <div>
        <h2 className="font-medium">HighLevel Agent Studio tools</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Regina is the conversational front-end. ContractorYou owns scheduling after Regina triggers
          start-scheduling once. Regina must never tell a customer they are scheduled unless ContractorYou
          already sent the confirmation.
        </p>
      </div>
      {schedulingStatus ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-3 py-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Scheduling integration
          </p>
          <dl className="mt-2 grid gap-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted-foreground)]">Scheduling orchestration</dt>
              <dd>{schedulingStatus.orchestration}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted-foreground)]">Active scheduling sessions</dt>
              <dd>{schedulingStatus.activeSessions}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted-foreground)]">Last scheduling action</dt>
              <dd>
                {schedulingStatus.lastActionAt
                  ? `${schedulingStatus.lastActionAt}${schedulingStatus.lastActionTool ? ` · ${schedulingStatus.lastActionTool}` : ""}${
                      schedulingStatus.lastActionOk === false ? " · failed" : schedulingStatus.lastActionOk ? " · ok" : ""
                    }`
                  : "None yet"}
              </dd>
            </div>
            {schedulingStatus.lastErrorCode ? (
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Last scheduling error</dt>
                <dd>
                  {schedulingStatus.lastErrorAt ? `${schedulingStatus.lastErrorAt} · ` : ""}
                  {schedulingStatus.lastErrorCode}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
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
