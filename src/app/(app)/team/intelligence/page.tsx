import Link from "next/link";
import { ShieldCheck, Sparkles } from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { confidenceForSampleSize, readiness } from "@/lib/technician-intelligence/core";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  saveJobTypeRequirementAction,
  saveTechnicianQualificationDefinitionAction,
  saveTechnicianSkillDefinitionAction,
} from "@/server/actions/technician-intelligence";

export default async function TeamIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; ready?: string; confidence?: string }>;
}) {
  const ctx = await requirePermission("technician_intelligence:view");
  const query = await searchParams;
  const canViewTeam = can(ctx.role, "performance:view_team");
  const [memberships, categories, qualificationDefinitions, requirements, skillsForConfiguration] = await Promise.all([
    prisma.membership.findMany({
    where: {
      companyId: ctx.company.id,
      status: "ACTIVE",
      role: { in: ["TECHNICIAN", "INSTALLER", "MANAGER"] },
      ...(canViewTeam ? {} : { userId: ctx.user.id }),
      ...(query.q
        ? {
            user: {
              OR: [
                { firstName: { contains: query.q, mode: "insensitive" } },
                { lastName: { contains: query.q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: {
      user: {
        include: {
          technicianIntelligenceProfiles: {
            where: { companyId: ctx.company.id },
            include: {
              skillRatings: { include: { skill: true }, orderBy: { rating: "desc" } },
              qualifications: true,
              preferences: true,
              performance: { where: { window: "ALL_TIME" } },
            },
          },
        },
      },
    },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    }),
    prisma.technicianJobCategory.findMany({
      where: { companyId: ctx.company.id, active: true, key: { not: "OTHER" } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.technicianQualificationDefinition.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.technicianJobTypeRequirement.findMany({
      where: { companyId: ctx.company.id },
    }),
    prisma.technicianSkillDefinition.findMany({
      where: { companyId: ctx.company.id },
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
    }),
  ]);

  const rows = memberships
    .map((membership) => {
      const profile = membership.user.technicianIntelligenceProfiles[0];
      const completed = profile?.performance.reduce((sum, metric) => sum + metric.completedJobs, 0) ?? 0;
      const ready = readiness({
        ratingCount: profile?.skillRatings.length ?? 0,
        qualificationCount: profile?.qualifications.length ?? 0,
        preferenceCount: profile?.preferences.length ?? 0,
        smartDispatchEligible: profile?.smartDispatchEligible ?? true,
      });
      return {
        membership,
        profile,
        completed,
        confidence: confidenceForSampleSize(completed),
        ready,
        best: profile?.skillRatings.filter((rating) => rating.rating >= 4).slice(0, 3) ?? [],
      };
    })
    .filter((row) => !query.ready || (query.ready === "yes" ? row.ready.ready : !row.ready.ready))
    .filter((row) => !query.confidence || row.confidence === query.confidence);

  return (
    <div className="space-y-7">
      <header className="overflow-hidden rounded-3xl bg-[var(--cy-navy)] p-6 text-white">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-300">Team</p>
            <h1 className="mt-2 font-display text-3xl tracking-tight">Technician Intelligence</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Qualifications, field strengths, preferences, and real job-type performance—the foundation for
              explainable Smart Dispatch.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm">
            <ShieldCheck className="text-emerald-300" />
            Eligibility first. Ranking second.
          </div>
        </div>
      </header>

      <form className="flex flex-wrap gap-2 rounded-2xl border bg-white p-3">
        <input
          name="q"
          defaultValue={query.q}
          placeholder="Search technician..."
          className="h-9 min-w-60 flex-1 rounded-lg border px-3 text-sm"
        />
        <select name="ready" defaultValue={query.ready || ""} className={selectClass}>
          <option value="">All readiness</option>
          <option value="yes">Smart Dispatch ready</option>
          <option value="no">Needs setup</option>
        </select>
        <select name="confidence" defaultValue={query.confidence || ""} className={selectClass}>
          <option value="">All confidence</option>
          <option value="INSUFFICIENT">Insufficient</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
        </select>
        <button className="rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white">Filter</button>
      </form>

      {rows.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map(({ membership, profile, completed, confidence, ready, best }) => (
            <Link
              key={membership.id}
              href={`/team/${membership.userId}/intelligence`}
              className="group rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                    {membership.role.replaceAll("_", " ")}
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">
                    {membership.user.firstName} {membership.user.lastName}
                  </h2>
                </div>
                <StatusBadge status={ready.ready ? "READY" : "NEEDS_SETUP"} />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Summary label="Best at" value={best.map((rating) => rating.skill.name).join(" / ") || "Needs evaluation"} />
                <Summary
                  label="Data confidence"
                  value={completed ? `${friendly(confidence)} · ${completed} jobs` : "Not enough data yet"}
                />
                <Summary label="Qualifications" value={`${profile?.qualifications.length ?? 0} recorded`} />
                <Summary
                  label="Setup"
                  value={ready.ready ? "Smart Dispatch Ready" : `Missing ${ready.missing.join(", ")}`}
                />
              </div>
              <p className="mt-4 flex items-center gap-1 text-sm font-semibold text-[var(--cy-orange)]">
                <Sparkles className="size-4" /> Open intelligence profile →
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No matching technician profiles"
          description="Invite a technician or adjust the filters. ContractorYou starts with owner evaluation and learns from completed jobs."
        />
      )}

      {can(ctx.role, "technician_intelligence:manage") ? (
        <section className="rounded-2xl border bg-white p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
            Eligibility rules
          </p>
          <h2 className="mt-1 text-xl font-semibold text-[var(--cy-navy)]">Job-type requirements</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            A required qualification is a hard constraint. Performance, proximity, and preferences can never override it.
          </p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {categories.map((category) => (
              <div key={category.id} className="rounded-xl border p-3">
                <p className="font-medium">{category.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {qualificationDefinitions.map((qualification) => {
                    const enabled = requirements.some(
                      (requirement) =>
                        requirement.categoryId === category.id &&
                        requirement.qualificationDefinitionId === qualification.id
                    );
                    return (
                      <ActionForm key={qualification.id} action={saveJobTypeRequirementAction}>
                        <input type="hidden" name="categoryId" value={category.id} />
                        <input type="hidden" name="qualificationDefinitionId" value={qualification.id} />
                        <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
                        <Button type="submit" size="sm" variant={enabled ? "default" : "outline"}>
                          {enabled ? "✓ " : "+ "}{qualification.name}
                        </Button>
                      </ActionForm>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <details className="mt-6 border-t pt-4">
            <summary className="cursor-pointer font-medium text-[var(--cy-navy)]">Customize skills & qualifications</summary>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Starter definitions are editable configuration. Deactivating a skill preserves historical ratings.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ActionForm action={saveTechnicianSkillDefinitionAction} className="space-y-2 rounded-xl border p-4">
                <p className="font-medium">Add custom skill</p>
                <Input name="name" placeholder="Skill name" />
                <select name="group" className={selectClass}>
                  <option value="SERVICE">Service</option>
                  <option value="OPPORTUNITY">Sales / opportunity</option>
                  <option value="INSTALL">Install</option>
                </select>
                <select name="categoryId" className={selectClass}>
                  <option value="">No call-type link</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <Button type="submit">Add skill</Button>
              </ActionForm>
              <ActionForm action={saveTechnicianQualificationDefinitionAction} className="space-y-2 rounded-xl border p-4">
                <p className="font-medium">Add custom qualification</p>
                <Input name="name" placeholder="Qualification name" />
                <Button type="submit">Add qualification</Button>
              </ActionForm>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {skillsForConfiguration.map((skill) => (
                <ActionForm key={skill.id} action={saveTechnicianSkillDefinitionAction} className="flex gap-2 rounded-xl border p-2">
                  <input type="hidden" name="skillId" value={skill.id} />
                  <input type="hidden" name="group" value={skill.group} />
                  <input type="hidden" name="categoryId" value={skill.categoryId || ""} />
                  <input type="hidden" name="active" value={skill.active ? "false" : "true"} />
                  <Input name="name" defaultValue={skill.name} />
                  <Button type="submit" size="sm" variant="outline">{skill.active ? "Deactivate" : "Restore"}</Button>
                </ActionForm>
              ))}
            </div>
          </details>
        </section>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function friendly(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const selectClass = "h-9 rounded-lg border bg-white px-3 text-sm";
