import Link from "next/link";
import { notFound } from "next/navigation";
import { Award, CheckCircle2, RefreshCw, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import {
  averageOrNull,
  qualificationState,
  readiness,
  safeRate,
} from "@/lib/technician-intelligence/core";
import {
  refreshTechnicianPerformanceAction,
  saveTechnicianEvaluationAction,
  saveTechnicianPreferenceAction,
  saveTechnicianQualificationAction,
  saveTechnicianRecommendationOverrideAction,
  setTechnicianSmartDispatchEligibilityAction,
} from "@/server/actions/technician-intelligence";
import { ActionForm } from "@/components/action-form";
import { StarRating } from "@/components/technician-intelligence/star-rating";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/lib/money";

export default async function TechnicianIntelligenceProfilePage({
  params,
}: {
  params: Promise<{ technicianId: string }>;
}) {
  const ctx = await requirePermission("technician_intelligence:view");
  const { technicianId } = await params;
  const canViewTeam = can(ctx.role, "performance:view_team");
  if (!canViewTeam && technicianId !== ctx.user.id) notFound();
  const canManage = can(ctx.role, "technician_intelligence:manage");
  const showConfidential = can(ctx.role, "technician_intelligence:confidential");

  const [membership, skills, categories, qualificationDefinitions] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        companyId: ctx.company.id,
        userId: technicianId,
        role: { in: ["TECHNICIAN", "INSTALLER", "MANAGER"] },
      },
      include: {
        user: {
          include: {
            technicianIntelligenceProfiles: {
              where: { companyId: ctx.company.id },
              include: {
                skillRatings: { include: { skill: true } },
                qualifications: { include: { definition: true } },
                preferences: { include: { category: true } },
                performance: { where: { window: "ALL_TIME" }, include: { category: true } },
                overrides: { where: { active: true } },
              },
            },
          },
        },
      },
    }),
    prisma.technicianSkillDefinition.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.technicianJobCategory.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.technicianQualificationDefinition.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  if (!membership) notFound();

  const profile = membership.user.technicianIntelligenceProfiles[0];
  const ratingBySkill = new Map(profile?.skillRatings.map((rating) => [rating.skillId, rating]));
  const qualificationByDefinition = new Map(
    profile?.qualifications.map((qualification) => [qualification.definitionId, qualification])
  );
  const preferenceByCategory = new Map(
    profile?.preferences.map((preference) => [preference.categoryId, preference])
  );
  const ready = readiness({
    ratingCount: profile?.skillRatings.length ?? 0,
    qualificationCount: profile?.qualifications.length ?? 0,
    preferenceCount: profile?.preferences.length ?? 0,
    smartDispatchEligible: profile?.smartDispatchEligible ?? true,
  });
  const best = profile?.skillRatings
    .filter((rating) => rating.rating >= 4)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 4);
  const activeQualifications =
    profile?.qualifications.filter((qualification) => qualificationState(qualification) === "ACTIVE") ?? [];

  return (
    <div className="space-y-7">
      <Link href="/team/intelligence" className="text-sm text-[var(--muted-foreground)] hover:underline">
        ← Team Intelligence
      </Link>

      <header className="overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--cy-navy)] to-slate-700 p-6 text-white">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">
              Technician Intelligence
            </p>
            <h1 className="mt-2 font-display text-3xl tracking-tight">
              {membership.user.firstName} {membership.user.lastName}
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Owner evaluation stays separate from measured ContractorYou performance.
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-300">Smart Dispatch profile</p>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
              {ready.ready ? <CheckCircle2 className="text-emerald-300" /> : <ShieldAlert className="text-amber-300" />}
              {ready.ready ? "Ready" : "Needs setup"}
            </p>
            {!ready.ready ? <p className="mt-1 text-xs text-slate-300">Missing: {ready.missing.join(", ")}</p> : null}
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={Sparkles}
          label="Best at"
          value={best?.map((rating) => rating.skill.name).join(" · ") || "No owner evaluation yet"}
        />
        <SummaryCard
          icon={Award}
          label="Qualified for"
          value={activeQualifications.map((qualification) => qualification.definition.name).join(" · ") || "None recorded"}
        />
        <SummaryCard
          icon={TrendingUp}
          label="ContractorYou data"
          value={
            profile?.performance.some((metric) => metric.completedJobs)
              ? `${profile.performance.reduce((sum, metric) => sum + metric.completedJobs, 0)} categorized completed jobs`
              : "Not enough data yet"
          }
        />
      </section>

      {canManage ? (
        <Section
          eyebrow="Dispatch controls"
          title="Operational overrides"
          description="Use these for deliberate exceptions. Every change records the actor, time, prior state, and reason."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <ActionForm action={setTechnicianSmartDispatchEligibilityAction} className="rounded-xl border p-4">
              <input type="hidden" name="technicianId" value={technicianId} />
              <input type="hidden" name="enabled" value={profile?.smartDispatchEligible === false ? "true" : "false"} />
              <p className="font-medium">Smart Dispatch recommendations</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Currently {profile?.smartDispatchEligible === false ? "disabled" : "eligible"}.
              </p>
              <Input name="reason" className="mt-3" placeholder="Reason required when disabling" />
              <Button type="submit" className="mt-3" variant="outline">
                {profile?.smartDispatchEligible === false ? "Restore eligibility" : "Disable recommendations"}
              </Button>
            </ActionForm>
            <div className="rounded-xl border p-4">
              <p className="font-medium">Do not auto-recommend by call type</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                This is a ranking warning, not a qualification or availability change.
              </p>
              <div className="mt-3 space-y-2">
                {categories.filter((category) => category.key !== "OTHER").map((category) => {
                  const active = profile?.overrides.some(
                    (override) => override.kind === "DO_NOT_RECOMMEND" && override.categoryId === category.id
                  );
                  return (
                    <ActionForm key={category.id} action={saveTechnicianRecommendationOverrideAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="technicianId" value={technicianId} />
                      <input type="hidden" name="categoryId" value={category.id} />
                      <input type="hidden" name="active" value={active ? "false" : "true"} />
                      <Input name="reason" placeholder={`${category.name} reason`} className="min-w-48 flex-1" />
                      <Button type="submit" size="sm" variant={active ? "default" : "outline"}>
                        {active ? `Remove ${category.name}` : `Avoid ${category.name}`}
                      </Button>
                    </ActionForm>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>
      ) : null}

      <Section
        eyebrow="Owner evaluation"
        title="Field strengths"
        description="A manager's operational assessment—not a measured statistic. 1 means supervised; 5 means expert/preferred."
      >
        {canManage ? (
          <ActionForm action={saveTechnicianEvaluationAction} className="space-y-4">
            <input type="hidden" name="technicianId" value={technicianId} />
            <div className="grid gap-3 lg:grid-cols-2">
              {skills.map((skill) => {
                const current = ratingBySkill.get(skill.id);
                return (
                  <div key={skill.id} className="rounded-xl border p-3">
                    <input type="hidden" name="skillId" value={skill.id} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{skill.name}</p>
                        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {skill.group}
                        </p>
                      </div>
                      <StarRating name={`rating:${skill.id}`} defaultValue={current?.rating} />
                    </div>
                    <Input
                      name={`note:${skill.id}`}
                      defaultValue={showConfidential ? current?.managerNote || "" : ""}
                      placeholder="Optional private manager note"
                      className="mt-3"
                    />
                  </div>
                );
              })}
            </div>
            <Label htmlFor="profileNotes">Private coaching notes</Label>
            <Input
              id="profileNotes"
              name="profileNotes"
              defaultValue={showConfidential ? profile?.notes || "" : ""}
              placeholder="Optional"
            />
            <Button type="submit">Save owner evaluation</Button>
          </ActionForm>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {profile?.skillRatings.length ? (
              profile.skillRatings.map((rating) => (
                <MetricLine key={rating.id} label={rating.skill.name} value={`${"★".repeat(rating.rating)}${"☆".repeat(5 - rating.rating)}`} />
              ))
            ) : (
              <EmptyCopy>No owner evaluation yet.</EmptyCopy>
            )}
          </div>
        )}
      </Section>

      <Section
        eyebrow="Hard constraints"
        title="Qualifications"
        description="A high performance history never replaces an active required qualification."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {qualificationDefinitions.map((definition) => {
            const current = qualificationByDefinition.get(definition.id);
            const state = qualificationState(current);
            return (
              <div key={definition.id} className="rounded-xl border p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{definition.name}</p>
                  <StatusBadge status={state} />
                </div>
                {canManage ? (
                  <ActionForm action={saveTechnicianQualificationAction} className="mt-3 grid gap-2 sm:grid-cols-2">
                    <input type="hidden" name="technicianId" value={technicianId} />
                    <input type="hidden" name="definitionId" value={definition.id} />
                    <select name="status" defaultValue={current?.status || "ACTIVE"} className={selectClass}>
                      <option>ACTIVE</option>
                      <option>PENDING</option>
                      <option>INACTIVE</option>
                      <option>EXPIRED</option>
                    </select>
                    <Input name="certificationNumber" defaultValue={current?.certificationNumber || ""} placeholder="Certification #" />
                    <Input name="issuedDate" type="date" defaultValue={dateValue(current?.issuedDate)} />
                    <Input name="expirationDate" type="date" defaultValue={dateValue(current?.expirationDate)} />
                    <Input name="notes" defaultValue={current?.notes || ""} placeholder="Optional note" />
                    <Button type="submit" variant="outline">Save qualification</Button>
                  </ActionForm>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        eyebrow="Soft signals"
        title="Preferred & development calls"
        description="Preferences influence future ranking. They never create eligibility and development calls do not disqualify."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {categories.filter((category) => category.key !== "OTHER").map((category) => {
            const current = preferenceByCategory.get(category.id);
            return (
              <div key={category.id} className="rounded-xl border p-3">
                <p className="font-medium">{category.name}</p>
                {canManage ? (
                  <ActionForm action={saveTechnicianPreferenceAction} className="mt-2 flex flex-wrap gap-2">
                    <input type="hidden" name="technicianId" value={technicianId} />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <select name="preference" defaultValue={current?.preference || "NEUTRAL"} className={selectClass}>
                      <option value="NEUTRAL">Neutral</option>
                      <option value="PREFERRED">Preferred</option>
                      <option value="DEVELOPMENT">Developing</option>
                    </select>
                    <Input name="reason" defaultValue={current?.reason || ""} placeholder="Optional reason" className="min-w-48 flex-1" />
                    <Button type="submit" variant="outline">Save</Button>
                  </ActionForm>
                ) : (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">{current?.preference || "Neutral"}</p>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        eyebrow="ContractorYou data"
        title="Performance by call type"
        description="Only completed assigned jobs with canonical call-type evidence are counted. Callback metrics use explicit relationships."
        action={
          canManage ? (
            <ActionForm action={refreshTechnicianPerformanceAction}>
              <input type="hidden" name="technicianId" value={technicianId} />
              <Button type="submit" variant="outline"><RefreshCw /> Refresh from jobs</Button>
            </ActionForm>
          ) : null
        }
      >
        {profile?.performance.some((metric) => metric.completedJobs) ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {profile.performance.filter((metric) => metric.completedJobs).map((metric) => {
              const averageTicket = averageOrNull(metric.recognizedRevenueCents, metric.invoiceCount);
              const averageDuration = averageOrNull(metric.totalDurationMinutes, metric.validDurationCount);
              return (
                <div key={metric.id} className="rounded-xl border p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{metric.category.name}</h3>
                    <StatusBadge status={metric.confidence} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <MetricLine label="Completed" value={String(metric.completedJobs)} />
                    <MetricLine label="Average ticket" value={averageTicket == null ? "Not enough data" : formatMoney(averageTicket)} />
                    <MetricLine label="First-time completion" value={percent(metric.firstTimeCompletionCount, metric.completedJobs)} />
                    <MetricLine label="Callback rate" value={percent(metric.callbackCount, metric.completedJobs)} />
                    <MetricLine label="Average duration" value={averageDuration == null ? "Not enough data" : `${Math.round(averageDuration)} min`} />
                    <MetricLine label="Estimate conversion" value={percent(metric.estimateApprovedCount, metric.estimatePresentedCount)} />
                  </div>
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    {metric.confidence === "INSUFFICIENT"
                      ? `Early data — ${metric.completedJobs} completed jobs`
                      : `${friendly(metric.confidence)} confidence based on ${metric.completedJobs} completed jobs`}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyCopy>
            <strong>No performance data yet.</strong> ContractorYou will build this profile as assigned jobs are completed.
          </EmptyCopy>
        )}
      </Section>

      <Section
        eyebrow="Coaching"
        title="Opportunities"
        description="Private, operational context—never a public leaderboard."
      >
        {profile?.skillRatings.some((rating) => rating.rating <= 2) ? (
          <div className="flex flex-wrap gap-2">
            {profile.skillRatings.filter((rating) => rating.rating <= 2).map((rating) => (
              <span key={rating.id} className="rounded-full bg-amber-50 px-3 py-2 text-sm text-amber-950">
                {rating.skill.name} · Owner rating {rating.rating}/5
              </span>
            ))}
          </div>
        ) : (
          <EmptyCopy>Add 1–2 ratings or development calls to create a coaching focus.</EmptyCopy>
        )}
      </Section>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4">
      <Icon className="size-5 text-[var(--cy-orange)]" />
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function Section({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-white p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function EmptyCopy({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-slate-50 p-5 text-sm text-[var(--muted-foreground)]">{children}</p>;
}

function percent(numerator: number, denominator: number) {
  const value = safeRate(numerator, denominator);
  return value == null ? "Not enough data" : `${value}%`;
}
function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function dateValue(value?: Date | null) {
  return value?.toISOString().slice(0, 10) || "";
}

const selectClass = "h-9 rounded-lg border bg-white px-3 text-sm";
