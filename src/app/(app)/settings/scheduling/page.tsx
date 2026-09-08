import { can } from "@/lib/permissions";
import { requireAnyPermission } from "@/lib/tenant";
import { SchedulingSettingsView } from "@/components/scheduling/scheduling-settings-view";
import { loadSchedulingSettings } from "@/lib/scheduling/settings-data";

export const dynamic = "force-dynamic";

export default async function SchedulingSettingsPage() {
  const ctx = await requireAnyPermission(["company:settings", "schedule:manage"]);
  const data = await loadSchedulingSettings(ctx.company.id, ctx.company.timezone);
  const canEdit = can(ctx.role, "schedule:manage") || can(ctx.role, "company:settings");
  return <SchedulingSettingsView data={data} canEdit={canEdit} />;
}
