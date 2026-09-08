"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  deleteAppointmentWindowAction,
  deleteAvailabilityOverrideAction,
  saveAppointmentWindowAction,
  saveAutoBookingEnabledAction,
  saveAvailabilityOverrideAction,
  saveSchedulingPolicyAction,
  saveServiceTypeRuleAction,
  saveTechnicianWeekAction,
} from "@/server/actions/scheduling";
import { dayCapacitySummary, serviceRuleStatus } from "@/lib/scheduling/persist";
import { formatClockMinutes, formatLocalDateShort, formatWindowChip, WEEKDAY_LABELS } from "@/lib/scheduling/time";
import type { SchedulingSettingsData } from "@/lib/scheduling/settings-data";

const WEEKDAYS = [1, 2, 3, 4, 5] as const;
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
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

function ruleTone(rule?: SchedulingSettingsData["rules"][number]) {
  const status = serviceRuleStatus(rule);
  if (status === "MANUAL") return { label: "Manual", className: "bg-rose-50 text-rose-800" };
  if (status === "OFFICE_APPROVAL") return { label: "Office approval", className: "bg-amber-50 text-amber-900" };
  return { label: "Auto-book", className: "bg-emerald-50 text-emerald-800" };
}

export function SchedulingSettingsView({
  data,
  canEdit,
}: {
  data: SchedulingSettingsData;
  canEdit: boolean;
}) {
  const [windowsOpen, setWindowsOpen] = useState(false);
  const [techId, setTechId] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [serviceTypeId, setServiceTypeId] = useState<string | null>(null);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [todayWindowId, setTodayWindowId] = useState<string | null>(null);

  const activeWindows = data.windows.filter((window) => window.active);
  const todayByWindow = useMemo(() => {
    return activeWindows.map((window) => {
      const options = data.todayCapacity.filter((row) => row.windowId === window.id);
      const techs = new Set(options.map((row) => row.technicianId)).size;
      const slots = options.reduce((sum, row) => sum + row.remainingCapacity, 0);
      return { window, techs, slots };
    });
  }, [activeWindows, data.todayCapacity]);
  const availableToday = todayByWindow.reduce((sum, row) => sum + row.slots, 0);

  const tech = data.technicians.find((row) => row.userId === techId) ?? null;
  const serviceType = data.serviceTypes.find((row) => row.id === serviceTypeId) ?? null;
  const serviceRule = data.rules.find((row) => row.serviceTypeId === serviceTypeId);

  return (
    <div className="mx-auto max-w-6xl space-y-5 overflow-x-hidden pb-20 md:pb-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Settings · Operations
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Scheduling & Capacity</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Control when ContractorYou can automatically book work.
        </p>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Scheduling overview
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <OverviewStat label="Auto booking" value={data.policy.autoBookingEnabled ? "On" : "Off"} />
          <OverviewStat label="Appointment windows" value={String(activeWindows.length)} />
          <OverviewStat label="Active technicians" value={String(data.technicians.length)} />
          <OverviewStat label="Available today" value={availableToday === 0 ? "No availability" : `${availableToday} slots`} />
          <OverviewStat label="Maintenance booking" value={`${data.policy.maintenanceHorizonDays} days`} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.9fr)]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Appointment windows</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">When do we take appointments?</p>
              </div>
              {canEdit ? (
                <Button variant="outline" onClick={() => setWindowsOpen(true)}>
                  Edit windows
                </Button>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeWindows.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">No active windows yet.</p>
              ) : (
                activeWindows.map((window) => (
                  <span
                    key={window.id}
                    className="rounded-full border border-[var(--border)] bg-[var(--cy-gray)] px-3 py-1 text-sm text-[var(--cy-navy)]"
                  >
                    {formatWindowChip(window.startMinutes, window.endMinutes)}
                  </span>
                ))
              )}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setWindowsOpen(true)}
                  className="rounded-full border border-dashed border-[var(--border)] px-3 py-1 text-sm text-[var(--muted-foreground)]"
                >
                  + Add window
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <h2 className="font-medium text-[var(--cy-navy)]">Technician availability</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Who is available?</p>
            {data.technicians.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">Add technicians on the Team page first.</p>
            ) : (
              <>
                <div className="mt-3 hidden md:block">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                        <th className="pb-2 font-medium">Technician</th>
                        {WEEKDAYS.map((day) => (
                          <th key={day} className="pb-2 font-medium">
                            {WEEKDAY_LABELS[day].slice(0, 3)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.technicians.map((row) => (
                        <tr key={row.userId}>
                          <td className="py-1.5 pr-3">
                            <button
                              type="button"
                              onClick={() => setTechId(row.userId)}
                              className="font-medium text-[var(--cy-navy)] hover:underline"
                            >
                              {row.name}
                            </button>
                          </td>
                          {WEEKDAYS.map((day) => {
                            const summary = dayCapacitySummary(data.weekly, row.userId, day);
                            return (
                              <td key={day} className="py-1.5 text-[var(--muted-foreground)]">
                                {summary.available ? summary.capacity : "Off"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 space-y-2 md:hidden">
                  {data.technicians.map((row) => (
                    <button
                      key={row.userId}
                      type="button"
                      onClick={() => setTechId(row.userId)}
                      className="flex w-full flex-col gap-2 rounded-xl border border-[var(--border)] px-3 py-3 text-left"
                    >
                      <span className="font-medium text-[var(--cy-navy)]">{row.name}</span>
                      <span className="flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
                        {WEEKDAYS.map((day) => {
                          const summary = dayCapacitySummary(data.weekly, row.userId, day);
                          return (
                            <span key={day} className="rounded-full bg-[var(--cy-gray)] px-2 py-1">
                              {WEEKDAY_LABELS[day].slice(0, 3)} {summary.available ? summary.capacity : "Off"}
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <h2 className="font-medium text-[var(--cy-navy)]">What can auto-book?</h2>
            <ul className="mt-3 space-y-2">
              {data.serviceTypes.map((type) => {
                const tone = ruleTone(data.rules.find((rule) => rule.serviceTypeId === type.id));
                return (
                  <li key={type.id}>
                    <button
                      type="button"
                      onClick={() => setServiceTypeId(type.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--cy-gray)]"
                    >
                      <span className="text-sm font-medium text-[var(--cy-navy)]">{type.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.className}`}>
                        {tone.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <h2 className="font-medium text-[var(--cy-navy)]">Today’s capacity</h2>
            <ul className="mt-3 space-y-2">
              {todayByWindow.map(({ window, techs, slots }) => (
                <li key={window.id}>
                  <button
                    type="button"
                    onClick={() => setTodayWindowId(window.id === todayWindowId ? null : window.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-left"
                  >
                    <span className="text-sm font-medium">{formatWindowChip(window.startMinutes, window.endMinutes)}</span>
                    <span className="text-sm text-[var(--muted-foreground)]">
                      {slots === 0 ? "No availability" : `${techs} tech${techs === 1 ? "" : "s"} · ${slots} slot${slots === 1 ? "" : "s"}`}
                    </span>
                  </button>
                  {todayWindowId === window.id ? (
                    <ul className="mt-1 space-y-1 px-3 pb-1 text-sm text-[var(--muted-foreground)]">
                      {data.todayCapacity
                        .filter((row) => row.windowId === window.id)
                        .map((row) => (
                          <li key={row.technicianId}>
                            {row.technicianName} · {row.usedCapacity}/{row.configuredCapacity} booked
                          </li>
                        ))}
                      {data.todayCapacity.every((row) => row.windowId !== window.id) ? (
                        <li>No technicians open in this window.</li>
                      ) : null}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Auto booking</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {data.policy.autoBookingEnabled
                    ? "ContractorYou can automatically schedule eligible customer requests from conversations. HighLevel should only carry the texts — turn off HighLevel Conversation AI on SMS so it cannot send a second reply."
                    : "Auto booking is off. Requests become suggestions for the office."}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  data.policy.autoBookingEnabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"
                }`}
              >
                {data.policy.autoBookingEnabled ? "On" : "Off"}
              </span>
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Standard horizon</dt>
                <dd>{data.policy.standardHorizonDays} days</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Maintenance horizon</dt>
                <dd>{data.policy.maintenanceHorizonDays} days</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Same-day booking</dt>
                <dd>{data.policy.allowSameDay ? "On" : "Off"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Weekend booking</dt>
                <dd>{data.policy.allowWeekend ? "On" : "Off"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted-foreground)]">Customer auto-cancel</dt>
                <dd>{data.policy.autoCancelEnabled ? "On" : "Off"}</dd>
              </div>
            </dl>
            {canEdit ? (
              <div className="mt-4 space-y-2">
                <ActionForm action={saveAutoBookingEnabledAction} successMessage="Auto booking updated." className="flex gap-2">
                  <select
                    name="autoBookingEnabled"
                    defaultValue={data.policy.autoBookingEnabled ? "yes" : "no"}
                    className="h-11 flex-1 rounded-lg border border-[var(--border)] px-3 text-sm md:h-8"
                  >
                    <option value="no">Off</option>
                    <option value="yes">On</option>
                  </select>
                  <button type="submit" className="h-11 rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white md:h-8">
                    Save
                  </button>
                </ActionForm>
                <Button variant="outline" className="h-11 w-full md:h-8" onClick={() => setRulesOpen(true)}>
                  Edit rules
                </Button>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Schedule exceptions</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">PTO, training, extra hours.</p>
              </div>
              {canEdit ? (
                <Button variant="outline" onClick={() => setExceptionOpen(true)}>
                  + Add exception
                </Button>
              ) : null}
            </div>
            {data.exceptions.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">No upcoming exceptions.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {data.exceptions.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{formatLocalDateShort(row.date, data.timeZone)}</p>
                      <p className="text-[var(--muted-foreground)]">
                        {row.technicianName} · {formatWindowChip(row.startMinutes, row.endMinutes)} ·{" "}
                        {row.available ? "Extra availability" : "Blocked"}
                        {row.reason ? ` · ${row.reason}` : ""}
                      </p>
                    </div>
                    {canEdit ? (
                      <ActionForm action={deleteAvailabilityOverrideAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" className="text-sm text-[var(--muted-foreground)] underline">
                          Remove
                        </button>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canEdit ? (
            <button
              type="button"
              onClick={() => setAdvancedOpen(true)}
              className="w-full rounded-2xl border border-[var(--border)] bg-white px-4 py-3 text-left text-sm font-medium text-[var(--cy-navy)]"
            >
              Advanced scheduling settings
            </button>
          ) : null}
        </div>
      </div>

      <Sheet open={windowsOpen} onOpenChange={setWindowsOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto pb-24 md:pb-6 md:max-w-none">
          <SheetHeader>
            <SheetTitle>Appointment windows</SheetTitle>
            <SheetDescription>These are the arrival windows customers can book.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            {data.windows.map((window) => (
              <ActionForm
                key={window.id}
                action={saveAppointmentWindowAction}
                successMessage="Window saved."
                className="space-y-3 rounded-xl border border-[var(--border)] p-3"
              >
                <input type="hidden" name="id" value={window.id} />
                <input type="hidden" name="sortOrder" value={window.sortOrder} />
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input name="name" defaultValue={window.name} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Display label</Label>
                    <Input name="label" defaultValue={window.label ?? ""} />
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
                </div>
                <button type="submit" className="h-11 rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white md:h-8">
                  Save changes
                </button>
              </ActionForm>
            ))}
            <ActionForm action={saveAppointmentWindowAction} successMessage="Window added." className="space-y-3 rounded-xl border border-dashed border-[var(--border)] p-3">
              <p className="font-medium">Add window</p>
              <Input name="name" placeholder="Morning 1" required />
              <div className="grid gap-3 md:grid-cols-2">
                <ClockFields prefix="start" minutes={9 * 60} />
                <ClockFields prefix="end" minutes={11 * 60} />
              </div>
              <button type="submit" className="h-11 rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white md:h-8">
                Add window
              </button>
            </ActionForm>
            {data.windows.map((window) => (
              <ActionForm key={`del-${window.id}`} action={deleteAppointmentWindowAction}>
                <input type="hidden" name="id" value={window.id} />
                <button type="submit" className="text-sm text-[var(--muted-foreground)] underline">
                  Delete {window.name} if unused
                </button>
              </ActionForm>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <TechnicianEditor
        open={Boolean(tech)}
        onOpenChange={(open) => {
          if (!open) setTechId(null);
        }}
        tech={tech}
        data={data}
      />

      <Sheet open={rulesOpen || advancedOpen} onOpenChange={(open) => {
        if (!open) {
          setRulesOpen(false);
          setAdvancedOpen(false);
        }
      }}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto pb-24 md:pb-6 md:max-w-none">
          <SheetHeader>
            <SheetTitle>{advancedOpen ? "Advanced scheduling settings" : "Auto-booking rules"}</SheetTitle>
            <SheetDescription>These rules stay in ContractorYou. HighLevel only sends the texts.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <PolicyForm data={data} showAdvanced={advancedOpen || rulesOpen} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(serviceType)} onOpenChange={(open) => !open && setServiceTypeId(null)}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto pb-24 md:pb-6">
          <SheetHeader>
            <SheetTitle>{serviceType?.name}</SheetTitle>
            <SheetDescription>How ContractorYou treats this service type.</SheetDescription>
          </SheetHeader>
          {serviceType ? (
            <div className="px-4 pb-4">
              <ActionForm action={saveServiceTypeRuleAction} successMessage="Rule saved." className="space-y-3">
                <input type="hidden" name="serviceTypeId" value={serviceType.id} />
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                  Auto-book allowed
                  <input type="hidden" name="autoBookAllowed" value="no" />
                  <input
                    type="checkbox"
                    name="autoBookAllowed"
                    value="yes"
                    defaultChecked={serviceRule ? serviceRule.autoBookAllowed : true}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                  Office approval required
                  <input type="hidden" name="requiresOfficeApproval" value="no" />
                  <input
                    type="checkbox"
                    name="requiresOfficeApproval"
                    value="yes"
                    defaultChecked={serviceRule?.requiresOfficeApproval ?? false}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                  Maintenance visit
                  <input type="hidden" name="isMaintenance" value="no" />
                  <input
                    type="checkbox"
                    name="isMaintenance"
                    value="yes"
                    defaultChecked={serviceRule?.isMaintenance ?? /maintenance/i.test(serviceType.name)}
                  />
                </label>
                <button type="submit" className="h-11 w-full rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white">
                  Save changes
                </button>
              </ActionForm>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={exceptionOpen} onOpenChange={setExceptionOpen}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto pb-24 md:pb-6">
          <SheetHeader>
            <SheetTitle>Add exception</SheetTitle>
            <SheetDescription>Overrides the weekly template for one day and window.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <ActionForm
              action={saveAvailabilityOverrideAction}
              successMessage="Exception saved."
              className="space-y-3"
              onSuccess={() => setExceptionOpen(false)}
            >
              <div className="space-y-1.5">
                <Label>Technician</Label>
                <select name="userId" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                  {data.technicians.map((row) => (
                    <option key={row.userId} value={row.userId}>
                      {row.name}
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
                  {data.windows.map((window) => (
                    <option key={window.id} value={window.id}>
                      {window.name} · {formatClockMinutes(window.startMinutes)}–{formatClockMinutes(window.endMinutes)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select name="available" defaultValue="no" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                  <option value="no">Blocked</option>
                  <option value="yes">Extra availability</option>
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
              <button type="submit" className="h-11 w-full rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white">
                Save changes
              </button>
            </ActionForm>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--cy-gray)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 font-medium text-[var(--cy-navy)]">{value}</p>
    </div>
  );
}

function TechnicianEditor({
  open,
  onOpenChange,
  tech,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tech: SchedulingSettingsData["technicians"][number] | null;
  data: SchedulingSettingsData;
}) {
  const [draft, setDraft] = useState<Record<string, { available: boolean; capacity: number }>>({});

  const keyFor = (weekday: number, windowId: string) => `${weekday}:${windowId}`;

  const resolved = useMemo(() => {
    const next: Record<string, { available: boolean; capacity: number }> = {};
    for (const weekday of ALL_DAYS) {
      for (const window of data.windows) {
        const key = keyFor(weekday, window.id);
        const stored = data.weekly.find(
          (row) => row.userId === tech?.userId && row.windowId === window.id && row.weekday === weekday
        );
        next[key] = draft[key] ?? {
          available: stored?.available === true,
          capacity: stored?.capacity ?? 1,
        };
      }
    }
    return next;
  }, [data.weekly, data.windows, draft, tech?.userId]);

  function setSlot(weekday: number, windowId: string, patch: Partial<{ available: boolean; capacity: number }>) {
    const key = keyFor(weekday, windowId);
    setDraft((current) => ({
      ...current,
      [key]: { ...resolved[key], ...patch },
    }));
  }

  function copyMondayToWeekdays() {
    if (!tech) return;
    for (const weekday of [2, 3, 4, 5]) {
      for (const window of data.windows) {
        const monday = resolved[keyFor(1, window.id)];
        setSlot(weekday, window.id, monday);
      }
    }
  }

  function setWeekdaysOn() {
    for (const weekday of WEEKDAYS) {
      for (const window of data.windows) {
        setSlot(weekday, window.id, { available: true, capacity: resolved[keyFor(weekday, window.id)]?.capacity || 1 });
      }
    }
  }

  function clearDay(weekday: number) {
    for (const window of data.windows) {
      setSlot(weekday, window.id, { available: false });
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setDraft({});
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="h-[92vh] max-h-[92vh] overflow-y-auto pb-28 md:h-auto md:max-w-none md:pb-6">
        <SheetHeader>
          <SheetTitle>{tech?.name}</SheetTitle>
          <SheetDescription>When they work, and what they can take.</SheetDescription>
        </SheetHeader>
        {tech ? (
          <div className="px-4 pb-4">
            <ActionForm key={tech.userId} action={saveTechnicianWeekAction} successMessage="Technician schedule saved." className="space-y-5">
              <input type="hidden" name="userId" value={tech.userId} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyMondayToWeekdays} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  Copy Monday to weekdays
                </button>
                <button type="button" onClick={setWeekdaysOn} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  Set Monday–Friday
                </button>
              </div>
              {ALL_DAYS.map((weekday) => (
                <section key={weekday} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[var(--cy-navy)]">{WEEKDAY_LABELS[weekday]}</h3>
                    <button type="button" onClick={() => clearDay(weekday)} className="text-xs text-[var(--muted-foreground)] underline">
                      Clear day
                    </button>
                  </div>
                  {data.windows.map((window) => {
                    const key = keyFor(weekday, window.id);
                    const slot = resolved[key];
                    return (
                      <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2">
                        <span className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name={`available:${key}`}
                            value="true"
                            checked={slot.available}
                            onChange={(event) => setSlot(weekday, window.id, { available: event.target.checked })}
                          />
                          {formatClockMinutes(window.startMinutes)}–{formatClockMinutes(window.endMinutes)}
                        </span>
                        <span className="flex items-center gap-2 text-sm">
                          Capacity
                          <input
                            name={`capacity:${key}`}
                            type="number"
                            min={0}
                            value={slot.capacity}
                            onChange={(event) => setSlot(weekday, window.id, { capacity: Number(event.target.value || 0) })}
                            className="h-9 w-16 rounded-lg border border-[var(--border)] px-2"
                          />
                        </span>
                      </label>
                    );
                  })}
                </section>
              ))}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--cy-navy)]">Service eligibility</h3>
                {data.serviceTypes.map((type) => {
                  const row = data.eligibility.find((item) => item.userId === tech.userId && item.serviceTypeId === type.id);
                  return (
                    <label key={type.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm">
                      {type.name}
                      <input
                        type="checkbox"
                        name="eligibleServiceTypeId"
                        value={type.id}
                        defaultChecked={row ? row.eligible : true}
                      />
                    </label>
                  );
                })}
              </section>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="h-11 flex-1 rounded-lg border border-[var(--border)] text-sm font-medium"
                >
                  Cancel
                </button>
                <button type="submit" className="h-11 flex-1 rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white">
                  Save changes
                </button>
              </div>
            </ActionForm>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PolicyForm({ data, showAdvanced }: { data: SchedulingSettingsData; showAdvanced: boolean }) {
  return (
    <ActionForm action={saveSchedulingPolicyAction} successMessage="Scheduling rules saved." className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="allowOfficeOverride" value="yes" />
      <div className="space-y-1.5 md:col-span-2">
        <Label>Auto booking</Label>
        <select
          name="autoBookingEnabled"
          defaultValue={data.policy.autoBookingEnabled ? "yes" : "no"}
          className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
        >
          <option value="no">Off — suggest only</option>
          <option value="yes">On — book when rules allow</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Same-day booking</Label>
        <select name="allowSameDay" defaultValue={data.policy.allowSameDay ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
          <option value="yes">On</option>
          <option value="no">Off</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Weekend booking</Label>
        <select name="allowWeekend" defaultValue={data.policy.allowWeekend ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
          <option value="no">Off</option>
          <option value="yes">On</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Customer cancellation</Label>
        <select name="autoCancelEnabled" defaultValue={data.policy.autoCancelEnabled ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
          <option value="no">Office review</option>
          <option value="yes">Auto-cancel allowed</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Standard horizon (days)</Label>
        <Input name="standardHorizonDays" type="number" min={1} defaultValue={data.policy.standardHorizonDays} />
      </div>
      <div className="space-y-1.5">
        <Label>Maintenance horizon (days)</Label>
        <Input name="maintenanceHorizonDays" type="number" min={1} defaultValue={data.policy.maintenanceHorizonDays} />
      </div>
      {showAdvanced ? (
        <>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Company timezone</Label>
            <select name="timezone" defaultValue={data.policy.timezone} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              {[data.policy.timezone, ...TIMEZONES.filter((zone) => zone !== data.policy.timezone)].map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Minimum notice (minutes)</Label>
            <Input name="minNoticeMinutes" type="number" min={0} defaultValue={data.policy.minNoticeMinutes} />
          </div>
          <div className="space-y-1.5">
            <Label>Max jobs per window</Label>
            <Input name="maxJobsPerWindow" type="number" min={1} defaultValue={data.policy.maxJobsPerWindow ?? ""} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Max jobs per day</Label>
            <Input name="maxJobsPerDay" type="number" min={1} defaultValue={data.policy.maxJobsPerDay ?? ""} placeholder="Optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Emergency reserve per window</Label>
            <Input name="emergencyReservePerWindow" type="number" min={0} defaultValue={data.policy.emergencyReservePerWindow} />
          </div>
          <div className="space-y-1.5">
            <Label>Use emergency reserve</Label>
            <select name="allowEmergencyReserveUse" defaultValue={data.policy.allowEmergencyReserveUse ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Hold reserve</option>
              <option value="yes">Allow use</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Show technician name in texts</Label>
            <select name="showTechnicianName" defaultValue={data.policy.showTechnicianName ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Hide name</option>
              <option value="yes">Include name</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Paid one-time maintenance</Label>
            <select name="allowPaidOneTimeMaintenance" defaultValue={data.policy.allowPaidOneTimeMaintenance ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Membership only</option>
              <option value="yes">Allow paid one-time</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Default service type</Label>
            <select name="defaultServiceTypeId" defaultValue={data.policy.defaultServiceTypeId ?? ""} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="">First active type</option>
              {data.serviceTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Maintenance service type</Label>
            <select name="maintenanceServiceTypeId" defaultValue={data.policy.maintenanceServiceTypeId ?? ""} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="">Use default</option>
              {data.serviceTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Confirmation template</Label>
            <Input name="confirmationTemplate" defaultValue={data.policy.confirmationTemplate ?? ""} placeholder="Optional. Use {when} and {window}." />
          </div>
          <div className="space-y-1.5">
            <Label>Proactive maintenance texts</Label>
            <select name="proactiveOutreachEnabled" defaultValue={data.policy.proactiveOutreachEnabled ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Off</option>
              <option value="yes">On</option>
            </select>
          </div>
        </>
      ) : null}
      <button type="submit" className="h-11 rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white md:col-span-2">
        Save changes
      </button>
    </ActionForm>
  );
}
