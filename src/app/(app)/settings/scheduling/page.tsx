import Link from "next/link";
import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { ensureSchedulingSetup } from "@/lib/scheduling/ensure";
import { formatClockMinutes, WEEKDAY_LABELS, formatLocalDateShort } from "@/lib/scheduling/time";
import { loadCapacitySnapshot } from "@/lib/scheduling/capacity";
import { evaluateCapacity } from "@/lib/scheduling/capacity-engine";
import { companyTodayKey } from "@/lib/scheduling/time";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteAppointmentWindowAction,
  deleteAvailabilityOverrideAction,
  saveAppointmentWindowAction,
  saveAvailabilityOverrideAction,
  saveSchedulingPolicyAction,
  saveServiceTypeRuleAction,
  saveTechnicianAvailabilityAction,
  saveTechnicianEligibilityAction,
} from "@/server/actions/scheduling";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Pacific/Honolulu",
];

function ClockFields({ prefix, minutes }: { prefix: string; minutes: number }) {
  const hours24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hour = hours24 % 12 || 12;
  return (
    <div className="grid grid-cols-3 gap-2">
      <select name={`${prefix}Hour`} defaultValue={String(hour)} className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select name={`${prefix}Minute`} defaultValue={String(minute).padStart(2, "0")} className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm">
        {["00", "15", "30", "45"].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select name={`${prefix}Period`} defaultValue={period} className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm">
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

export default async function SchedulingSettingsPage() {
  const ctx = await requirePermission("company:settings");
  await ensureSchedulingSetup(prisma, ctx.company.id);
  const today = companyTodayKey(new Date(), ctx.company.timezone);
  const [
    windows,
    policy,
    techs,
    weekly,
    overrides,
    serviceTypes,
    rules,
    eligibility,
  ] = await Promise.all([
    prisma.appointmentWindow.findMany({
      where: { companyId: ctx.company.id },
      orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }],
    }),
    prisma.schedulingPolicy.findUnique({ where: { companyId: ctx.company.id } }),
    prisma.membership.findMany({
      where: { companyId: ctx.company.id, status: "ACTIVE", role: { in: ["TECHNICIAN", "INSTALLER"] } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.technicianWindowAvailability.findMany({ where: { companyId: ctx.company.id } }),
    prisma.availabilityOverride.findMany({
      where: { companyId: ctx.company.id, date: { gte: new Date(`${today}T00:00:00.000Z`) } },
      include: { user: { select: { firstName: true, lastName: true } }, window: true },
      orderBy: { date: "asc" },
      take: 40,
    }),
    prisma.serviceType.findMany({
      where: { companyId: ctx.company.id, active: true, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.serviceTypeSchedulingRule.findMany({ where: { companyId: ctx.company.id } }),
    prisma.technicianServiceEligibility.findMany({ where: { companyId: ctx.company.id } }),
  ]);

  const snapshot = await loadCapacitySnapshot(prisma, ctx.company.id, [today]);
  const todayCapacity = evaluateCapacity(snapshot, { companyId: ctx.company.id, date: today });

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div>
        <Link href="/settings" className="text-sm text-[var(--muted-foreground)] hover:underline">
          ← Settings
        </Link>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Settings · Operations
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Scheduling & Capacity</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Define your windows, tell us when each tech works, set capacity, then choose what can auto-book.
        </p>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Who is available today</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Real bookings only. {todayCapacity.options.length === 0 ? "No remaining capacity for today." : null}
        </p>
        <div className="mt-3 space-y-2">
          {windows.filter((window) => window.active).map((window) => {
            const rows = todayCapacity.options.filter((option) => option.windowId === window.id);
            const rejected = todayCapacity.rejected.filter((row) => row.windowId === window.id);
            return (
              <div key={window.id} className="rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                <p className="font-medium">
                  {window.name} · {formatClockMinutes(window.startMinutes)}–{formatClockMinutes(window.endMinutes)}
                </p>
                {rows.length ? (
                  <ul className="mt-1 text-[var(--muted-foreground)]">
                    {rows.map((row) => (
                      <li key={`${row.technicianId}-${row.windowId}`}>
                        {row.technicianName} {row.usedCapacity}/{row.configuredCapacity} booked
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[var(--muted-foreground)]">
                    {rejected.length ? "No remaining capacity in this window." : "No technicians configured for this window."}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Appointment windows</h2>
        <div className="space-y-3">
          {windows.map((window) => (
            <div key={window.id} className="rounded-xl border border-[var(--border)] p-3">
              <ActionForm action={saveAppointmentWindowAction} className="grid gap-3 md:grid-cols-2" successMessage="Window saved.">
                <input type="hidden" name="id" value={window.id} />
                <input type="hidden" name="sortOrder" value={window.sortOrder} />
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input name="name" defaultValue={window.name} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Display label</Label>
                  <Input name="label" defaultValue={window.label ?? ""} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label>Start</Label>
                  <ClockFields prefix="start" minutes={window.startMinutes} />
                </div>
                <div className="space-y-1.5">
                  <Label>End</Label>
                  <ClockFields prefix="end" minutes={window.endMinutes} />
                </div>
                <div className="space-y-1.5">
                  <Label>Daypart</Label>
                  <select name="daypart" defaultValue={window.daypart} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                    <option value="MORNING">Morning</option>
                    <option value="AFTERNOON">Afternoon</option>
                    <option value="EVENING">Evening</option>
                    <option value="ANY">Any</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Active</Label>
                  <select name="active" defaultValue={window.active ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                    <option value="yes">Active</option>
                    <option value="no">Disabled</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Button type="submit">Save window</Button>
                </div>
              </ActionForm>
              <ActionForm action={deleteAppointmentWindowAction} className="mt-2">
                <input type="hidden" name="id" value={window.id} />
                <Button type="submit" variant="ghost">
                  Delete unused window
                </Button>
              </ActionForm>
            </div>
          ))}
        </div>
        <ActionForm action={saveAppointmentWindowAction} className="grid gap-3 rounded-xl border border-dashed border-[var(--border)] p-3 md:grid-cols-2" successMessage="Window added.">
          <div className="space-y-1.5 md:col-span-2">
            <Label>New window</Label>
            <Input name="name" placeholder="Morning 1" required />
          </div>
          <div className="space-y-1.5">
            <Label>Start</Label>
            <ClockFields prefix="start" minutes={9 * 60} />
          </div>
          <div className="space-y-1.5">
            <Label>End</Label>
            <ClockFields prefix="end" minutes={11 * 60} />
          </div>
          <Button type="submit" className="md:col-span-2">
            Add window
          </Button>
        </ActionForm>
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Technician availability</h2>
        {techs.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Add technicians on the Team page before setting capacity.</p>
        ) : (
          techs.map((tech) => (
            <div key={tech.user.id} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
              <h3 className="font-medium">
                {tech.user.firstName} {tech.user.lastName}
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-[40rem] w-full text-left text-sm">
                  <thead>
                    <tr className="text-[var(--muted-foreground)]">
                      <th className="pb-2 font-medium">Day</th>
                      {windows.map((window) => (
                        <th key={window.id} className="pb-2 font-medium">
                          {formatClockMinutes(window.startMinutes)}–{formatClockMinutes(window.endMinutes)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKDAY_LABELS.map((label, weekday) => (
                      <tr key={label}>
                        <td className="py-1 pr-2 font-medium">{label.slice(0, 3)}</td>
                        {windows.map((window) => {
                          const row = weekly.find(
                            (item) => item.userId === tech.user.id && item.windowId === window.id && item.weekday === weekday
                          );
                          return (
                            <td key={window.id} className="py-1 pr-2">
                              <ActionForm action={saveTechnicianAvailabilityAction} className="flex flex-wrap items-center gap-1">
                                <input type="hidden" name="userId" value={tech.user.id} />
                                <input type="hidden" name="windowId" value={window.id} />
                                <input type="hidden" name="weekday" value={weekday} />
                                <select name="available" defaultValue={row?.available ? "yes" : "no"} className="h-8 rounded-md border border-[var(--border)] px-1 text-xs">
                                  <option value="yes">On</option>
                                  <option value="no">Off</option>
                                </select>
                                <Input name="capacity" type="number" min={0} defaultValue={row?.capacity ?? 1} className="h-8 w-14" />
                                <Button type="submit" size="xs">
                                  Save
                                </Button>
                              </ActionForm>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Date overrides</h2>
        <ActionForm action={saveAvailabilityOverrideAction} className="grid gap-3 md:grid-cols-2" successMessage="Override saved.">
          <div className="space-y-1.5">
            <Label>Technician</Label>
            <select name="userId" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              {techs.map((tech) => (
                <option key={tech.user.id} value={tech.user.id}>
                  {tech.user.firstName} {tech.user.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input name="date" type="date" required />
          </div>
          <div className="space-y-1.5">
            <Label>Window</Label>
            <select name="windowId" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              {windows.map((window) => (
                <option key={window.id} value={window.id}>
                  {window.name} · {formatClockMinutes(window.startMinutes)}–{formatClockMinutes(window.endMinutes)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Available</Label>
            <select name="available" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Unavailable</option>
              <option value="yes">Available</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Capacity override</Label>
            <Input name="capacity" type="number" min={0} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input name="reason" placeholder="Training, PTO, extra Saturday" />
          </div>
          <Button type="submit" className="md:col-span-2">
            Add override
          </Button>
        </ActionForm>
        {overrides.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">No upcoming overrides.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {overrides.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2">
                <span>
                  {row.user.firstName} {row.user.lastName} · {formatLocalDateShort(row.date.toISOString().slice(0, 10), ctx.company.timezone)} · {row.window.name} ·{" "}
                  {row.available ? `Available · capacity ${row.capacity ?? "unchanged"}` : "Unavailable"}
                  {row.reason ? ` · ${row.reason}` : ""}
                </span>
                <ActionForm action={deleteAvailabilityOverrideAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Remove
                  </Button>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Auto-booking rules</h2>
        <ActionForm action={saveSchedulingPolicyAction} className="mt-3 grid gap-3 md:grid-cols-2" successMessage="Scheduling rules saved.">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Company timezone</Label>
            <select name="timezone" defaultValue={ctx.company.timezone} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              {[ctx.company.timezone, ...TIMEZONES.filter((zone) => zone !== ctx.company.timezone)].map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Auto booking</Label>
            <select name="autoBookingEnabled" defaultValue={policy?.autoBookingEnabled ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Off — suggest only</option>
              <option value="yes">On — book when rules allow</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Same-day booking</Label>
            <select name="allowSameDay" defaultValue={policy?.allowSameDay ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="yes">Allowed</option>
              <option value="no">Not allowed</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Weekend booking</Label>
            <select name="allowWeekend" defaultValue={policy?.allowWeekend ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Weekdays only</option>
              <option value="yes">Weekends allowed</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Customer cancellation</Label>
            <select name="autoCancelEnabled" defaultValue={policy?.autoCancelEnabled ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Office review</option>
              <option value="yes">Auto-cancel allowed</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Minimum notice (minutes)</Label>
            <Input name="minNoticeMinutes" type="number" min={0} defaultValue={policy?.minNoticeMinutes ?? 120} />
          </div>
          <div className="space-y-1.5">
            <Label>Standard booking horizon (days)</Label>
            <Input name="standardHorizonDays" type="number" min={1} defaultValue={policy?.standardHorizonDays ?? 90} />
          </div>
          <div className="space-y-1.5">
            <Label>Maintenance booking horizon (days)</Label>
            <Input name="maintenanceHorizonDays" type="number" min={1} defaultValue={policy?.maintenanceHorizonDays ?? 365} />
          </div>
          <div className="space-y-1.5">
            <Label>Max jobs per window</Label>
            <Input name="maxJobsPerWindow" type="number" min={1} defaultValue={policy?.maxJobsPerWindow ?? ""} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Max jobs per day</Label>
            <Input name="maxJobsPerDay" type="number" min={1} defaultValue={policy?.maxJobsPerDay ?? ""} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Emergency reserve per window</Label>
            <Input name="emergencyReservePerWindow" type="number" min={0} defaultValue={policy?.emergencyReservePerWindow ?? 0} />
          </div>
          <div className="space-y-1.5">
            <Label>Use emergency reserve</Label>
            <select name="allowEmergencyReserveUse" defaultValue={policy?.allowEmergencyReserveUse ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Hold reserve</option>
              <option value="yes">Allow use</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Show technician name in texts</Label>
            <select name="showTechnicianName" defaultValue={policy?.showTechnicianName ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Hide name</option>
              <option value="yes">Include name</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Paid one-time maintenance</Label>
            <select name="allowPaidOneTimeMaintenance" defaultValue={policy?.allowPaidOneTimeMaintenance ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Membership only</option>
              <option value="yes">Allow paid one-time</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Default service type</Label>
            <select name="defaultServiceTypeId" defaultValue={policy?.defaultServiceTypeId ?? ""} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="">First active type</option>
              {serviceTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Maintenance service type</Label>
            <select name="maintenanceServiceTypeId" defaultValue={policy?.maintenanceServiceTypeId ?? ""} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="">Use default</option>
              {serviceTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Confirmation template</Label>
            <Input name="confirmationTemplate" defaultValue={policy?.confirmationTemplate ?? ""} placeholder="Optional. Use {when} and {window}." />
          </div>
          <div className="space-y-1.5">
            <Label>Proactive maintenance texts</Label>
            <select name="proactiveOutreachEnabled" defaultValue={policy?.proactiveOutreachEnabled ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Off — foundation only</option>
              <option value="yes">On — only if you enable this</option>
            </select>
          </div>
          <input type="hidden" name="allowOfficeOverride" value="yes" />
          <Button type="submit" className="md:col-span-2">
            Save rules
          </Button>
        </ActionForm>
      </section>

      <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Service / job type rules</h2>
        {serviceTypes.map((type) => {
          const rule = rules.find((row) => row.serviceTypeId === type.id);
          return (
            <ActionForm key={type.id} action={saveServiceTypeRuleAction} className="grid gap-2 rounded-xl border border-[var(--border)] p-3 md:grid-cols-4" successMessage="Rule saved.">
              <input type="hidden" name="serviceTypeId" value={type.id} />
              <p className="font-medium md:col-span-4">{type.name}</p>
              <select name="autoBookAllowed" defaultValue={rule?.autoBookAllowed === false ? "no" : "yes"} className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm">
                <option value="yes">Auto-book allowed</option>
                <option value="no">Do not auto-book</option>
              </select>
              <select name="requiresOfficeApproval" defaultValue={rule?.requiresOfficeApproval ? "yes" : "no"} className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm">
                <option value="no">No office approval</option>
                <option value="yes">Office approval</option>
              </select>
              <select name="isMaintenance" defaultValue={rule?.isMaintenance ? "yes" : "no"} className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm">
                <option value="no">Regular service</option>
                <option value="yes">Maintenance</option>
              </select>
              <Button type="submit">Save</Button>
            </ActionForm>
          );
        })}
      </section>

      <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-5">
        <h2 className="font-medium">Technician eligibility</h2>
        {techs.map((tech) => (
          <div key={tech.user.id} className="rounded-xl border border-[var(--border)] p-3">
            <p className="font-medium">
              {tech.user.firstName} {tech.user.lastName}
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {serviceTypes.map((type) => {
                const row = eligibility.find((item) => item.userId === tech.user.id && item.serviceTypeId === type.id);
                return (
                  <ActionForm key={type.id} action={saveTechnicianEligibilityAction} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5">
                    <input type="hidden" name="userId" value={tech.user.id} />
                    <input type="hidden" name="serviceTypeId" value={type.id} />
                    <span className="text-sm">{type.name}</span>
                    <select name="eligible" defaultValue={row?.eligible === false ? "no" : "yes"} className="h-8 rounded-md border border-[var(--border)] px-2 text-xs">
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                    <Button type="submit" size="xs">
                      Save
                    </Button>
                  </ActionForm>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
