import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import {
  reviewReceptionistTurnAction,
  saveApprovedExampleAction,
  saveConversationRuleAction,
  saveKnowledgeItemAction,
  saveOpportunityRuleAction,
} from "@/server/actions/receptionist-training";
import { formatDateTime } from "@/lib/datetime";

const TABS = [
  { id: "home", label: "Overview" },
  { id: "knowledge", label: "Knowledge" },
  { id: "rules", label: "Conversation rules" },
  { id: "opportunities", label: "Opportunities" },
  { id: "examples", label: "Approved examples" },
  { id: "review", label: "Review queue" },
] as const;

type Counts = {
  knowledge: number;
  rules: number;
  opportunities: number;
  examples: number;
  needsReview: number;
};

export function TrainingCenter(props: {
  tab: string;
  canEdit: boolean;
  counts: Counts;
  knowledge: Array<{ id: string; question: string; answer: string; category: string; notes: string | null; active: boolean }>;
  rules: Array<{ id: string; body: string; active: boolean; priority: number }>;
  opportunities: Array<{
    id: string;
    type: string;
    title: string;
    triggerText: string;
    verifiedRequirement: string;
    suggestedBehavior: string;
    cta: string | null;
    active: boolean;
    priority: number;
  }>;
  examples: Array<{
    id: string;
    customerMessage: string;
    preferredResponse: string;
    intent: string;
    notes: string | null;
    active: boolean;
  }>;
  reviews: Array<{
    id: string;
    customerMessage: string | null;
    proposedResponse: string | null;
    intent: string;
    requestedAction: string | null;
    toolUsed: string | null;
    schedulingState: string | null;
    createdAt: Date;
  }>;
}) {
  const tab = TABS.some((item) => item.id === props.tab) ? props.tab : "home";
  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/settings/highlevel/training?tab=${item.id}`}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === item.id ? "bg-[var(--cy-navy)] text-white" : "border border-[var(--border)] bg-white"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "home" ? (
        <section className="space-y-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            Add information Regina is allowed to use. Show her how you want conversations handled. Help her
            recognize customer opportunities — without being pushy.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card href="knowledge" title="Business knowledge" count={`${props.counts.knowledge} active items`} />
            <Card href="rules" title="Conversation rules" count={`${props.counts.rules} active rules`} />
            <Card href="opportunities" title="Opportunities" count={`${props.counts.opportunities} active rules`} />
            <Card href="examples" title="Approved examples" count={`${props.counts.examples} examples`} />
            <Card href="review" title="Needs review" count={`${props.counts.needsReview} conversations`} />
          </div>
          <Link href="/settings/highlevel/training?tab=knowledge">
            <Button type="button">Train Regina</Button>
          </Link>
        </section>
      ) : null}

      {tab === "knowledge" ? (
        <section className="space-y-4">
          <h2 className="font-medium">Knowledge</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Verified facts Regina may answer from. She can paraphrase, but she cannot invent prices or policies.
          </p>
          {props.canEdit ? (
            <ActionForm action={saveKnowledgeItemAction} className="space-y-2 rounded-2xl border border-[var(--border)] bg-white p-4">
              <input name="question" placeholder="Question" className="w-full rounded-xl border px-3 py-2 text-sm" />
              <textarea name="answer" placeholder="Answer Regina is allowed to use" rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" />
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="category" defaultValue="FAQ" className="rounded-xl border px-3 py-2 text-sm" />
                <input name="notes" placeholder="Internal notes (optional)" className="rounded-xl border px-3 py-2 text-sm" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked /> Active
              </label>
              <Button type="submit">Add knowledge</Button>
            </ActionForm>
          ) : null}
          <ul className="space-y-2">
            {props.knowledge.map((item) => (
              <li key={item.id} className="rounded-2xl border border-[var(--border)] bg-white p-4 text-sm">
                {props.canEdit ? (
                  <ActionForm action={saveKnowledgeItemAction} className="space-y-2">
                    <input type="hidden" name="id" value={item.id} />
                    <input name="question" defaultValue={item.question} className="w-full rounded-xl border px-3 py-2" />
                    <textarea name="answer" defaultValue={item.answer} rows={3} className="w-full rounded-xl border px-3 py-2" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input name="category" defaultValue={item.category} className="rounded-xl border px-3 py-2" />
                      <input name="notes" defaultValue={item.notes ?? ""} className="rounded-xl border px-3 py-2" />
                    </div>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="active" defaultChecked={item.active} /> Active
                    </label>
                    <Button type="submit" variant="outline">Save</Button>
                  </ActionForm>
                ) : (
                  <>
                    <p className="font-medium">{item.question}</p>
                    <p className="mt-1 text-[var(--muted-foreground)]">{item.answer}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "rules" ? (
        <section className="space-y-4">
          <h2 className="font-medium">Conversation rules</h2>
          {props.canEdit ? (
            <ActionForm action={saveConversationRuleAction} className="space-y-2 rounded-2xl border bg-white p-4">
              <textarea name="body" placeholder="How Regina should talk" rows={2} className="w-full rounded-xl border px-3 py-2 text-sm" />
              <input name="priority" type="number" defaultValue={100} className="w-32 rounded-xl border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked /> Active
              </label>
              <Button type="submit">Add rule</Button>
            </ActionForm>
          ) : null}
          <ul className="space-y-2">
            {props.rules.map((rule) => (
              <li key={rule.id} className="rounded-2xl border bg-white p-4 text-sm">
                {props.canEdit ? (
                  <ActionForm action={saveConversationRuleAction} className="space-y-2">
                    <input type="hidden" name="id" value={rule.id} />
                    <textarea name="body" defaultValue={rule.body} rows={2} className="w-full rounded-xl border px-3 py-2" />
                    <input name="priority" type="number" defaultValue={rule.priority} className="w-32 rounded-xl border px-3 py-2" />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="active" defaultChecked={rule.active} /> Active
                    </label>
                    <Button type="submit" variant="outline">Save</Button>
                  </ActionForm>
                ) : (
                  <p>{rule.body}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "opportunities" ? (
        <section className="space-y-4">
          <h2 className="font-medium">Opportunities</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            One helpful offer at a time, only when ContractorYou can verify the situation. Never enroll or charge anyone from here.
          </p>
          {props.canEdit ? (
            <ActionForm action={saveOpportunityRuleAction} className="space-y-2 rounded-2xl border bg-white p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <select name="type" defaultValue="MAINTENANCE" className="rounded-xl border px-3 py-2 text-sm">
                  <option value="MAINTENANCE">Maintenance / membership</option>
                  <option value="ESTIMATE_FOLLOW_UP">Estimate follow-up</option>
                  <option value="PAYMENT">Payment</option>
                  <option value="WAITING_ON_PART">Waiting on part</option>
                  <option value="SECOND_PROPERTY">Second property</option>
                  <option value="MAINTENANCE_DUE">Maintenance due</option>
                  <option value="POST_SERVICE_REVIEW">Post-service review</option>
                  <option value="REPLACEMENT">Replacement / sales</option>
                </select>
                <input name="title" placeholder="Title" className="rounded-xl border px-3 py-2 text-sm" />
              </div>
              <input name="triggerText" placeholder="When this comes up" className="w-full rounded-xl border px-3 py-2 text-sm" />
              <input name="verifiedRequirement" placeholder="What must be verified first" className="w-full rounded-xl border px-3 py-2 text-sm" />
              <textarea name="suggestedBehavior" placeholder="What Regina should do" rows={2} className="w-full rounded-xl border px-3 py-2 text-sm" />
              <input name="cta" placeholder="Optional short offer line" className="w-full rounded-xl border px-3 py-2 text-sm" />
              <input name="priority" type="number" defaultValue={10} className="w-32 rounded-xl border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked /> Active
              </label>
              <Button type="submit">Add opportunity</Button>
            </ActionForm>
          ) : null}
          <ul className="space-y-2">
            {props.opportunities.map((rule) => (
              <li key={rule.id} className="rounded-2xl border bg-white p-4 text-sm">
                {props.canEdit ? (
                  <ActionForm action={saveOpportunityRuleAction} className="space-y-2">
                    <input type="hidden" name="id" value={rule.id} />
                    <input name="type" defaultValue={rule.type} className="w-full rounded-xl border px-3 py-2" />
                    <input name="title" defaultValue={rule.title} className="w-full rounded-xl border px-3 py-2" />
                    <input name="triggerText" defaultValue={rule.triggerText} className="w-full rounded-xl border px-3 py-2" />
                    <input name="verifiedRequirement" defaultValue={rule.verifiedRequirement} className="w-full rounded-xl border px-3 py-2" />
                    <textarea name="suggestedBehavior" defaultValue={rule.suggestedBehavior} rows={2} className="w-full rounded-xl border px-3 py-2" />
                    <input name="cta" defaultValue={rule.cta ?? ""} className="w-full rounded-xl border px-3 py-2" />
                    <input name="priority" type="number" defaultValue={rule.priority} className="w-32 rounded-xl border px-3 py-2" />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="active" defaultChecked={rule.active} /> Active
                    </label>
                    <Button type="submit" variant="outline">Save</Button>
                  </ActionForm>
                ) : (
                  <p className="font-medium">{rule.title}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "examples" ? (
        <section className="space-y-4">
          <h2 className="font-medium">Approved examples</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            These teach tone and structure. They are not exact scripts, and real ContractorYou records always win.
          </p>
          {props.canEdit ? (
            <ActionForm action={saveApprovedExampleAction} className="space-y-2 rounded-2xl border bg-white p-4">
              <textarea name="customerMessage" placeholder="Customer message / situation" rows={2} className="w-full rounded-xl border px-3 py-2 text-sm" />
              <textarea name="preferredResponse" placeholder="How you want Regina to answer" rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" />
              <input name="intent" defaultValue="MEMBERSHIP" className="w-full rounded-xl border px-3 py-2 text-sm" />
              <input name="notes" placeholder="Notes (optional)" className="w-full rounded-xl border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked /> Active
              </label>
              <Button type="submit">Add example</Button>
            </ActionForm>
          ) : null}
          <ul className="space-y-2">
            {props.examples.map((item) => (
              <li key={item.id} className="rounded-2xl border bg-white p-4 text-sm">
                {props.canEdit ? (
                  <ActionForm action={saveApprovedExampleAction} className="space-y-2">
                    <input type="hidden" name="id" value={item.id} />
                    <textarea name="customerMessage" defaultValue={item.customerMessage} rows={2} className="w-full rounded-xl border px-3 py-2" />
                    <textarea name="preferredResponse" defaultValue={item.preferredResponse} rows={3} className="w-full rounded-xl border px-3 py-2" />
                    <input name="intent" defaultValue={item.intent} className="w-full rounded-xl border px-3 py-2" />
                    <input name="notes" defaultValue={item.notes ?? ""} className="w-full rounded-xl border px-3 py-2" />
                    <label className="flex items-center gap-2">
                      <input type="checkbox" name="active" defaultChecked={item.active} /> Active
                    </label>
                    <Button type="submit" variant="outline">Save</Button>
                  </ActionForm>
                ) : (
                  <p>{item.preferredResponse}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "review" ? (
        <section className="space-y-4">
          <h2 className="font-medium">Review queue</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            A thumbs-down does not change Regina. Someone has to approve the better wording first.
          </p>
          {props.reviews.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">Nothing waiting for review.</p>
          ) : (
            <ul className="space-y-3">
              {props.reviews.map((row) => (
                <li key={row.id} className="rounded-2xl border bg-white p-4 text-sm">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {formatDateTime(row.createdAt)} · {row.intent} · {row.schedulingState || "no workflow"} ·{" "}
                    {row.toolUsed || row.requestedAction || "none"}
                  </p>
                  <p className="mt-2"><span className="text-[var(--muted-foreground)]">Customer: </span>{row.customerMessage || "—"}</p>
                  <p className="mt-1"><span className="text-[var(--muted-foreground)]">Regina: </span>{row.proposedResponse || "—"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <ActionForm action={reviewReceptionistTurnAction}>
                      <input type="hidden" name="turnId" value={row.id} />
                      <input type="hidden" name="decision" value="GOOD" />
                      <Button type="submit" variant="outline">Good response</Button>
                    </ActionForm>
                    <ActionForm action={reviewReceptionistTurnAction}>
                      <input type="hidden" name="turnId" value={row.id} />
                      <input type="hidden" name="decision" value="IGNORE" />
                      <Button type="submit" variant="outline">Ignore</Button>
                    </ActionForm>
                  </div>
                  {props.canEdit ? (
                    <ActionForm action={reviewReceptionistTurnAction} className="mt-3 space-y-2">
                      <input type="hidden" name="turnId" value={row.id} />
                      <input type="hidden" name="decision" value="IMPROVE" />
                      <input type="hidden" name="customerMessage" value={row.customerMessage || ""} />
                      <textarea name="improvedText" placeholder="What should Regina have said?" rows={3} className="w-full rounded-xl border px-3 py-2" />
                      <select name="saveAs" className="w-full rounded-xl border px-3 py-2">
                        <option value="example">Save as approved example</option>
                        <option value="knowledge">Create knowledge item</option>
                        <option value="rule">Create conversation rule</option>
                        <option value="opportunity">Create opportunity rule (starts off)</option>
                      </select>
                      <Button type="submit">Improve response</Button>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Card({ href, title, count }: { href: string; title: string; count: string }) {
  return (
    <Link href={`/settings/highlevel/training?tab=${href}`} className="rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-[var(--cy-orange)]/40">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">{count}</p>
    </Link>
  );
}
