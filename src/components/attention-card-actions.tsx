"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { startAttentionActionAction } from "@/server/actions/action-engine";
import { attentionCardActions } from "@/lib/attention-actions";

export function AttentionCardActions({ type, entityId, href }: { type: string; entityId: string; href: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const actions = attentionCardActions(type, entityId);

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((action) => {
        if (action.prepare) {
          return (
            <button
              key={action.label}
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await startAttentionActionAction({ type, entityId });
                  if (result.ok && result.request) router.push(`/actions/${result.request.id}`);
                  else router.push(`/intelligence?ask=${encodeURIComponent(action.label)}`);
                });
              }}
              className="rounded-full bg-[var(--cy-navy)] px-3 py-1.5 text-xs font-medium text-white"
            >
              {pending ? "Preparing…" : action.label}
            </button>
          );
        }
        if (action.ask) {
          return (
            <Link
              key={action.label}
              href={`/intelligence?ask=${encodeURIComponent(action.ask)}`}
              className="rounded-full bg-[var(--cy-orange-muted)] px-3 py-1.5 text-xs font-medium text-[#9A3412]"
            >
              {action.label}
            </Link>
          );
        }
        return (
          <Link
            key={action.label}
            href={action.href || href}
            className="rounded-full bg-[var(--cy-gray)] px-3 py-1.5 text-xs font-medium text-[var(--cy-navy)]"
          >
            {action.label}
          </Link>
        );
      })}
    </div>
  );
}
