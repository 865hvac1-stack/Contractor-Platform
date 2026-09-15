import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { requirePermission } from "@/lib/tenant";
import { can } from "@/lib/permissions";
import { loadProjectsDashboard } from "@/lib/projects/load";
import { PROJECT_STATUSES, PROJECT_TYPES, friendlyProject } from "@/lib/projects/core";
import { formatMoney, formatMoneyCompact } from "@/lib/money";
import { buttonVariants, Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; status?: string; type?: string }>;
}) {
  const ctx = await requirePermission("projects:view");
  const params = await searchParams;
  const view = ["pipeline", "all", "financial", "attention"].includes(params.view || "") ? params.view! : "pipeline";
  const showFinancial = can(ctx.role, "projects:financial_view");
  const rows = await loadProjectsDashboard({ companyId: ctx.company.id, role: ctx.role, userId: ctx.user.id, q: params.q, status: params.status, type: params.type });
  const visibleRows = view === "attention" ? rows.filter((row) => row!.health.status !== "ON_TRACK")
    : rows;
  const active = rows.filter((row) => row!.project.status !== "COMPLETE");
  const total = (key: "currentValueCents" | "remainingToBillCents" | "outstandingBalanceCents" | "projectedGrossProfitCents") => active.reduce((sum, row) => sum + row!.financials[key], 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="font-display text-3xl tracking-tight">Projects</h1><p className="mt-1 text-sm text-[var(--muted-foreground)]">Manage multi-day work from planning through final payment.</p></div>
        {can(ctx.role, "projects:manage") ? <Link href="/projects/new" className={buttonVariants({ size: "lg" })}><Plus /> New Project</Link> : null}
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Active Projects" value={String(active.length)} />
        {showFinancial ? <><Kpi label="Contracted Value" value={formatMoneyCompact(total("currentValueCents"))} /><Kpi label="Remaining to Bill" value={formatMoneyCompact(total("remainingToBillCents"))} /><Kpi label="Outstanding A/R" value={formatMoneyCompact(total("outstandingBalanceCents"))} /><Kpi label="Projected Gross Profit" value={formatMoneyCompact(total("projectedGrossProfitCents"))} /></> : null}
        <Kpi label="Needs Attention" value={String(rows.filter((row) => row!.health.status !== "ON_TRACK").length)} tone="attention" />
      </section>

      <nav className="flex gap-2 overflow-x-auto">{[["pipeline", "Pipeline"], ["all", "All Projects"], ["financial", "Financial"], ["attention", "Needs Attention"]].filter(([key]) => key !== "financial" || showFinancial).map(([key, label]) => <Link key={key} href={`/projects?view=${key}`} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${view === key ? "bg-[var(--cy-navy)] text-white" : "border bg-white text-[var(--muted-foreground)]"}`}>{label}</Link>)}</nav>

      <form className="grid gap-2 rounded-2xl border bg-white p-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <input type="hidden" name="view" value={view} />
        <Input name="q" defaultValue={params.q} placeholder="Search project, address, customer, builder, or number" />
        <select name="status" defaultValue={params.status || ""} className={selectClass}><option value="">All statuses</option>{PROJECT_STATUSES.map((value) => <option key={value} value={value}>{friendlyProject(value)}</option>)}</select>
        <select name="type" defaultValue={params.type || ""} className={selectClass}><option value="">All project types</option>{PROJECT_TYPES.map((value) => <option key={value} value={value}>{friendlyProject(value)}</option>)}</select>
        <Button type="submit" variant="outline">Filter</Button>
      </form>

      {!visibleRows.length ? <Empty canCreate={can(ctx.role, "projects:manage")} filtered={Boolean(params.q || params.status || params.type || view === "attention")} /> : view === "pipeline" ? (
        <div className="grid gap-4 xl:grid-cols-3">{PROJECT_STATUSES.filter((status) => status !== "COMPLETE").map((status) => {
          const grouped = visibleRows.filter((row) => row!.project.status === status);
          return <section key={status} className="rounded-2xl bg-[var(--cy-gray)] p-3"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-[var(--cy-navy)]">{friendlyProject(status)}</h2><span className="text-xs text-[var(--muted-foreground)]">{grouped.length}</span></div><div className="space-y-3">{grouped.map((row) => <ProjectCard key={row!.project.id} row={row!} showFinancial={showFinancial} />)}{!grouped.length ? <p className="rounded-xl border border-dashed bg-white p-4 text-center text-xs text-[var(--muted-foreground)]">No projects</p> : null}</div></section>;
        })}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{visibleRows.map((row) => <ProjectCard key={row!.project.id} row={row!} showFinancial={showFinancial} financialFocus={view === "financial"} />)}</div>
      )}
    </div>
  );
}

function ProjectCard({ row, showFinancial, financialFocus = false }: { row: NonNullable<Awaited<ReturnType<typeof loadProjectsDashboard>>[number]>; showFinancial: boolean; financialFocus?: boolean }) {
  const project = row.project;
  const openIssues = project.issues.filter((issue) => issue.status !== "RESOLVED").length;
  const materialBlockers = project.materialRequests.filter((request) => request.status === "OPEN" && request.urgency === "BLOCKING").length;
  const laborBudget = project.laborBudgetMinutes;
  const laborStatus = laborBudget == null ? "No budget" : row.actualLaborMinutes > laborBudget ? "Over budget" : `${Math.max(0, laborBudget - row.actualLaborMinutes) / 60} hrs left`;
  return (
    <Link href={`/projects/${project.id}`} className="block rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold text-[var(--cy-orange)]">{project.projectNumber}</p><h3 className="mt-1 font-semibold text-[var(--cy-navy)]">{project.name}</h3><p className="mt-1 text-xs text-[var(--muted-foreground)]">{friendlyProject(project.type)} · {project.builderName || `${project.customer.firstName} ${project.customer.lastName}`}</p></div><StatusBadge status={row.health.status} /></div>
      <p className="mt-3 text-sm text-[var(--muted-foreground)]">{project.property.address}, {project.property.city}</p>
      <div className="mt-3 rounded-xl bg-[var(--cy-gray)] p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Current phase</p><p className="mt-1 text-sm font-medium">{row.currentPhase?.name || "No phase"}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">Next: {row.nextStep}</p></div>
      {showFinancial ? <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Stat label="Project value" value={formatMoney(row.financials.currentValueCents)} /><Stat label={financialFocus ? "Projected GP" : "Projected margin"} value={financialFocus ? formatMoney(row.financials.projectedGrossProfitCents) : `${(row.financials.projectedMarginBps / 100).toFixed(1)}%`} /></div> : null}
      <div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full border px-2 py-1">Labor: {laborStatus}</span>{row.upcomingVisit ? <span className="rounded-full border px-2 py-1">Visit {row.upcomingVisit.scheduledStart?.toLocaleDateString()}</span> : null}{openIssues ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1">{openIssues} open issue{openIssues === 1 ? "" : "s"}</span> : null}{materialBlockers ? <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-1">{materialBlockers} material blocker{materialBlockers === 1 ? "" : "s"}</span> : null}</div>
    </Link>
  );
}
function Kpi({ label, value, tone }: { label: string; value: string; tone?: "attention" }) {
  return <div className={`rounded-2xl border bg-white p-4 ${tone ? "border-amber-300" : ""}`}><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--cy-navy)]">{value}</p></div>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}
function Empty({ canCreate, filtered }: { canCreate: boolean; filtered: boolean }) {
  return <div className="rounded-3xl border border-dashed bg-white px-6 py-14 text-center"><FolderKanban className="mx-auto size-10 text-[var(--cy-orange)]" /><h2 className="mt-4 text-xl font-semibold text-[var(--cy-navy)]">{filtered ? "No projects match these filters" : "No projects yet"}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted-foreground)]">Projects are for work spanning multiple days, phases, crews, materials, and billing milestones—such as new construction, multi-day installs, remodels, and commercial work.</p>{canCreate ? <Link href="/projects/new" className={`${buttonVariants()} mt-5`}><Plus /> Create your first project</Link> : null}</div>;
}
const selectClass = "h-8 rounded-lg border bg-white px-3 text-sm";
