import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/tenant";
import { isFieldRole } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { landingPath } from "@/lib/workspaces";
import { AskContractorYou } from "@/components/ask-contractoryou";
import { getHomeSummary } from "@/lib/home";
import { CommandHero } from "@/components/home/command-hero";
import { NeedsYou } from "@/components/home/needs-you";
import { BusinessSnapshot } from "@/components/home/business-snapshot";

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const HOME_PROMPTS = [
  "What needs me today?",
  "Who owes us money?",
  "Which estimates need follow-up?",
  "Who is ready to schedule?",
  "How are we doing this month?",
];

export default async function DashboardPage() {
  const ctx = await requirePermission("dashboard:view");
  if (isFieldRole(ctx.role)) redirect(landingPath(ctx.role));

  const canSeeMoney = can(ctx.role, "invoices:view");
  const canAsk = can(ctx.role, "intelligence:view");
  const data = await getHomeSummary(ctx.company.id);
  const greeting = greetingForHour(new Date().getHours());
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: ctx.company.timezone || undefined,
  }).format(new Date());

  const waitingHref =
    data.today.readyToSchedule > 0 ? "/operations/waiting?focus=ready" : "/operations/waiting?focus=waiting";
  const waitingContext =
    data.today.readyToSchedule === 1
      ? "1 ready to schedule"
      : data.today.readyToSchedule > 1
        ? `${data.today.readyToSchedule} ready to schedule`
        : data.today.waitingCount === 0
          ? "No jobs waiting"
          : null;

  const metrics = [
    { label: "Jobs today", value: String(data.today.jobsToday), href: "/jobs?when=today" },
    { label: "In progress", value: String(data.today.inProgressToday), href: "/dispatch" },
    { label: "Waiting", value: String(data.today.waitingCount), href: waitingHref, context: waitingContext },
    { label: "Completed", value: String(data.today.completedToday), href: "/jobs?status=COMPLETED&when=today" },
  ];

  return (
    <div className="mx-auto max-w-[1480px] space-y-8 md:space-y-10">
      <CommandHero
        greeting={greeting}
        firstName={ctx.user.firstName}
        dateLabel={dateLabel}
        metrics={metrics}
        needsYouTotal={data.needsYouTotal}
      />

      <NeedsYou items={data.needsYou} total={data.needsYouTotal} />

      {canAsk ? (
        <AskContractorYou variant="bar" suggestions={HOME_PROMPTS} placeholder="Ask anything about your business..." />
      ) : null}

      {canSeeMoney ? (
        <BusinessSnapshot snapshot={data.snapshot} canReports={can(ctx.role, "reports:view")} />
      ) : null}
    </div>
  );
}
