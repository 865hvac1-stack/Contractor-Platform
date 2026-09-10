"use client";

import Link from "next/link";
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
  addSchedulingTechnicianAction,
  deleteAppointmentWindowAction,
  deleteAvailabilityOverrideAction,
  removeSchedulingTechnicianAction,
  reorderAppointmentWindowsAction,
  saveAppointmentWindowAction,
  saveAutoBookingEnabledAction,
  saveAvailabilityOverrideAction,
  saveSchedulingPolicyAction,
  saveServiceTypeRulesBatchAction,
  saveTechnicianWeekAction,
} from "@/server/actions/scheduling";
import { EXCEPTION_KIND_LABELS, EXCEPTION_KINDS, type ExceptionKind } from "@/lib/scheduling/exceptions";
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

function ClockFields({
  prefix,
  minutes,
  required = true,
}: {
  prefix: string;
  minutes: number;
  required?: boolean;
}) {
  const hours24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hour = hours24 % 12 || 12;
  return (
    <div className="grid grid-cols-3 gap-2">
      <select
        name={`${prefix}Hour`}
        defaultValue={String(hour)}
        required={required}
        className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select
        name={`${prefix}Minute`}
        defaultValue={String(minute).padStart(2, "0")}
        className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm"
      >
        {["00", "15", "30", "45"].map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <select
        name={`${prefix}Period`}
        defaultValue={period}
        className="h-10 rounded-lg border border-[var(--border)] px-2 text-sm"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

function ruleTone(rule?: SchedulingSettingsData["rules"][number]) {
  const status = serviceRuleStatus(rule);
  if (status === "MANUAL") return { label: "Off", className: "bg-slate-100 text-slate-700" };
  if (status === "OFFICE_APPROVAL") return { label: "Office", className: "bg-amber-50 text-amber-900" };
  return { label: "On", className: "bg-emerald-50 text-emerald-800" };
}

function drawerClass() {
  return "h-full w-full overflow-y-auto pb-24 sm:max-w-xl data-[side=right]:w-full md:pb-6";
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
  const [addTechOpen, setAddTechOpen] = useState(false);
  const [expandedTechId, setExpandedTechId] = useState<string | null>(null);
  const [autoBookOpen, setAutoBookOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [todayWindowId, setTodayWindowId] = useState<string | null>(null);

  const activeWindows = data.windows.filter((window) => window.active);
  const availableToday = data.todayWindows.reduce((sum, row) => sum + row.remainingCapacity, 0);
  const autoBookEnabledCount = data.serviceTypes.filter((type) => {
    const status = serviceRuleStatus(data.rules.find((rule) => rule.serviceTypeId === type.id));
    return status === "AUTO_BOOK";
  }).length;
  const activeTechnicians = data.technicians.filter((row) => row.scheduled).length;

  const tech = data.technicians.find((row) => row.userId === techId) ?? null;

  function openToday() {
    document.getElementById("todays-capacity")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTodayWindowId(data.todayWindows[0]?.windowId ?? null);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 overflow-x-hidden pb-20 md:pb-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Settings · Operations
        </p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Scheduling & Capacity</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Configure the live schedule ContractorYou and Regina use to offer and book work.
        </p>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">
          Scheduling overview
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <OverviewStat
            label="Auto booking"
            value={data.policy.autoBookingEnabled ? "On" : "Off"}
            onClick={canEdit ? () => setRulesOpen(true) : undefined}
          />
          <OverviewStat
            label="Appointment windows"
            value={String(activeWindows.length)}
            onClick={canEdit ? () => setWindowsOpen(true) : undefined}
          />
          <OverviewStat
            label="Active technicians"
            value={String(activeTechnicians)}
            onClick={() => document.getElementById("technicians-capacity")?.scrollIntoView({ behavior: "smooth" })}
          />
          <OverviewStat
            label="Available today"
            value={availableToday === 0 ? "No availability" : `${availableToday} slots`}
            onClick={openToday}
          />
          <OverviewStat
            label="Maintenance booking"
            value={`${data.policy.maintenanceHorizonDays} days`}
            onClick={canEdit ? () => setRulesOpen(true) : undefined}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.9fr)]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Appointment windows</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">When customers can book.</p>
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
                  <button
                    key={window.id}
                    type="button"
                    onClick={() => canEdit && setWindowsOpen(true)}
                    className="rounded-full border border-[var(--border)] bg-[var(--cy-gray)] px-3 py-1 text-sm text-[var(--cy-navy)]"
                  >
                    {formatWindowChip(window.startMinutes, window.endMinutes)}
                  </button>
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

          <section id="technicians-capacity" className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Technicians & Capacity</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">Who can take work, and how many appointments.</p>
              </div>
              {canEdit ? (
                <Button variant="outline" onClick={() => setAddTechOpen(true)}>
                  + Add Technician
                </Button>
              ) : null}
            </div>
            {data.technicians.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                No one is on the schedule yet. Add an existing teammate — Owner, Manager, Technician, or Installer.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {data.technicians.map((row) => {
                  const expanded = expandedTechId === row.userId;
                  return (
                    <div key={row.userId} className="rounded-xl border border-[var(--border)]">
                      <button
                        type="button"
                        onClick={() => setExpandedTechId(expanded ? null : row.userId)}
                        className="flex w-full flex-col gap-2 px-3 py-3 text-left md:flex-row md:items-center md:justify-between"
                      >
                        <span>
                          <span className="font-medium text-[var(--cy-navy)]">{row.name}</span>
                          <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                            {row.roleLabel} · {row.scheduled ? "Active" : "Not scheduled"}
                          </span>
                        </span>
                        <span className="flex flex-wrap gap-1.5 text-xs text-[var(--muted-foreground)]">
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
                      {expanded ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
                          <p className="text-xs text-[var(--muted-foreground)]">
                            Capacity is per appointment window and feeds the live booking engine.
                          </p>
                          {canEdit ? (
                            <Button size="sm" variant="outline" onClick={() => setTechId(row.userId)}>
                              Edit Schedule
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Auto-booking</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {autoBookEnabledCount} service type{autoBookEnabledCount === 1 ? "" : "s"} enabled
                </p>
              </div>
              {canEdit ? (
                <Button variant="outline" onClick={() => setAutoBookOpen(true)}>
                  Manage
                </Button>
              ) : null}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section id="todays-capacity" className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <h2 className="font-medium text-[var(--cy-navy)]">Today’s Capacity</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">Calculated from the same engine Regina uses.</p>
            <ul className="mt-3 space-y-2">
              {activeWindows.map((window) => {
                const summary = data.todayWindows.find((row) => row.windowId === window.id);
                const remaining = summary?.remainingCapacity ?? 0;
                const configured = summary?.configuredCapacity ?? 0;
                const open = todayWindowId === window.id;
                return (
                  <li key={window.id}>
                    <button
                      type="button"
                      onClick={() => setTodayWindowId(open ? null : window.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-left"
                    >
                      <span className="text-sm font-medium">
                        {formatWindowChip(window.startMinutes, window.endMinutes)}
                      </span>
                      <span className="text-sm text-[var(--muted-foreground)]">
                        {remaining === 0 ? "No availability" : `${remaining} of ${configured} available`}
                      </span>
                    </button>
                    {open ? (
                      <div className="mt-1 space-y-2 px-3 pb-2 text-sm text-[var(--muted-foreground)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em]">Eligible technicians</p>
                        {summary?.technicians.length ? (
                          <ul className="space-y-1">
                            {summary.technicians.map((row) => (
                              <li key={row.technicianId}>
                                {row.technicianName} · {row.usedCapacity}/{row.configuredCapacity} booked ·{" "}
                                {row.remainingCapacity} left
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No technicians open in this window.</p>
                        )}
                        <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.12em]">Booked jobs</p>
                        {data.todayBookings.filter((row) => row.windowId === window.id).length ? (
                          <ul className="space-y-1">
                            {data.todayBookings
                              .filter((row) => row.windowId === window.id)
                              .map((row) => (
                                <li key={row.jobId}>
                                  {row.jobNumber} · {row.customerName} · {row.technicianName}
                                </li>
                              ))}
                          </ul>
                        ) : (
                          <p>No bookings in this window today.</p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Auto booking</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {data.policy.autoBookingEnabled
                    ? "ContractorYou can automatically schedule eligible requests. HighLevel only carries the texts."
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
                  Edit Rules
                </Button>
              </div>
            ) : null}
          </section>

          <section className="rounded-2xl border border-[var(--border)] bg-white p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium text-[var(--cy-navy)]">Schedule exceptions</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">PTO, training, extra hours, holidays.</p>
              </div>
              {canEdit ? (
                <Button variant="outline" onClick={() => setExceptionOpen(true)}>
                  + Add Exception
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
                        {row.technicianName} · {formatWindowChip(row.startMinutes, row.endMinutes)} · {row.summary}
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

      <WindowsSheet data={data} open={windowsOpen} onOpenChange={setWindowsOpen} canEdit={canEdit} />

      <AddTechnicianSheet
        data={data}
        open={addTechOpen}
        onOpenChange={setAddTechOpen}
        onAdded={(userId) => {
          setAddTechOpen(false);
          setTechId(userId);
        }}
      />

      <TechnicianEditor
        open={Boolean(tech)}
        onOpenChange={(open) => {
          if (!open) setTechId(null);
        }}
        tech={tech}
        data={data}
      />

      <Sheet open={autoBookOpen} onOpenChange={setAutoBookOpen}>
        <SheetContent side="right" className={drawerClass()}>
          <SheetHeader>
            <SheetTitle>Auto-book service types</SheetTitle>
            <SheetDescription>Only enabled types can be booked by Regina without the office.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <ActionForm
              action={saveServiceTypeRulesBatchAction}
              successMessage="Auto-book settings saved."
              className="space-y-2"
              onSuccess={() => setAutoBookOpen(false)}
            >
              {data.serviceTypes.map((type) => {
                const rule = data.rules.find((row) => row.serviceTypeId === type.id);
                const enabled = serviceRuleStatus(rule) === "AUTO_BOOK";
                return (
                  <label
                    key={type.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-[var(--cy-navy)]">{type.name}</span>
                    <span className="flex items-center gap-2">
                      <input type="hidden" name="serviceTypeId" value={type.id} />
                      <input type="hidden" name={`autoBookAllowed:${type.id}`} value="no" />
                      <input
                        type="checkbox"
                        name={`autoBookAllowed:${type.id}`}
                        value="yes"
                        defaultChecked={enabled}
                      />
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ruleTone(rule).className}`}>
                        {enabled ? "On" : "Off"}
                      </span>
                    </span>
                  </label>
                );
              })}
              <button type="submit" className="mt-3 h-11 w-full rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white">
                Save changes
              </button>
            </ActionForm>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={rulesOpen || advancedOpen}
        onOpenChange={(open) => {
          if (!open) {
            setRulesOpen(false);
            setAdvancedOpen(false);
          }
        }}
      >
        <SheetContent side="right" className={drawerClass()}>
          <SheetHeader>
            <SheetTitle>{advancedOpen ? "Advanced scheduling settings" : "Auto-booking rules"}</SheetTitle>
            <SheetDescription>These rules stay in ContractorYou. HighLevel only sends the texts.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <PolicyForm data={data} showAdvanced={advancedOpen} />
          </div>
        </SheetContent>
      </Sheet>

      <ExceptionSheet data={data} open={exceptionOpen} onOpenChange={setExceptionOpen} />
    </div>
  );
}

function OverviewStat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const className = "rounded-xl bg-[var(--cy-gray)] px-3 py-2 text-left";
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 font-medium text-[var(--cy-navy)]">{value}</p>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} transition hover:ring-1 hover:ring-[var(--cy-orange)]/40`}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

function WindowsSheet({
  data,
  open,
  onOpenChange,
  canEdit,
}: {
  data: SchedulingSettingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
}) {
  if (!canEdit) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={drawerClass()}>
        <SheetHeader>
          <SheetTitle>Edit appointment windows</SheetTitle>
          <SheetDescription>These persisted windows are the only times Regina can offer.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {data.windows.map((window, index) => {
            const ordered = (from: number, to: number) => {
              const next = data.windows.map((row) => row.id);
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              return next.map((id) => data.windows.find((row) => row.id === id)!);
            };
            const up = index > 0 ? ordered(index, index - 1) : [];
            const down = index < data.windows.length - 1 ? ordered(index, index + 1) : [];
            return (
              <div key={window.id} className="space-y-3 rounded-xl border border-[var(--border)] p-3">
                <ActionForm action={saveAppointmentWindowAction} successMessage="Window saved." className="space-y-3">
                  <input type="hidden" name="id" value={window.id} />
                  <input type="hidden" name="sortOrder" value={window.sortOrder} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Start</Label>
                      <ClockFields prefix="start" minutes={window.startMinutes} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>End</Label>
                      <ClockFields prefix="end" minutes={window.endMinutes} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="hidden" name="active" value="no" />
                      <input type="checkbox" name="active" value="yes" defaultChecked={window.active} />
                      Enabled
                    </label>
                    <button type="submit" className="h-10 rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white">
                      Save
                    </button>
                  </div>
                </ActionForm>
                <div className="flex flex-wrap gap-2">
                  {index > 0 ? (
                    <ActionForm action={reorderAppointmentWindowsAction}>
                      {up.map((row) => (
                        <input key={row.id} type="hidden" name="windowId" value={row.id} />
                      ))}
                      <button type="submit" className="text-xs text-[var(--muted-foreground)] underline">
                        Move up
                      </button>
                    </ActionForm>
                  ) : null}
                  {index < data.windows.length - 1 ? (
                    <ActionForm action={reorderAppointmentWindowsAction}>
                      {down.map((row) => (
                        <input key={row.id} type="hidden" name="windowId" value={row.id} />
                      ))}
                      <button type="submit" className="text-xs text-[var(--muted-foreground)] underline">
                        Move down
                      </button>
                    </ActionForm>
                  ) : null}
                  <ActionForm action={deleteAppointmentWindowAction}>
                    <input type="hidden" name="id" value={window.id} />
                    <button type="submit" className="text-xs text-[var(--muted-foreground)] underline">
                      Delete if unused
                    </button>
                  </ActionForm>
                </div>
              </div>
            );
          })}
          <ActionForm action={saveAppointmentWindowAction} successMessage="Window added." className="space-y-3 rounded-xl border border-dashed border-[var(--border)] p-3">
            <p className="font-medium">Add appointment window</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <ClockFields prefix="start" minutes={9 * 60} />
              </div>
              <div className="space-y-1.5">
                <Label>End time</Label>
                <ClockFields prefix="end" minutes={11 * 60} />
              </div>
            </div>
            <button type="submit" className="h-11 rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white">
              + Add Appointment Window
            </button>
          </ActionForm>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AddTechnicianSheet({
  data,
  open,
  onOpenChange,
  onAdded,
}: {
  data: SchedulingSettingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (userId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const matches = data.eligibleToAdd.filter((row) => {
    const haystack = `${row.name} ${row.roleLabel}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setSelected("");
        }
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className={drawerClass()}>
        <SheetHeader>
          <SheetTitle>Add technician</SheetTitle>
          <SheetDescription>Select an existing teammate. This does not create a second employee record.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search owner, manager, technician, installer"
          />
          {matches.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">
              No eligible teammates left to add. Invite someone from Team first.
            </p>
          ) : (
            <ul className="space-y-2">
              {matches.map((row) => (
                <li key={row.userId}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.userId)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                      selected === row.userId
                        ? "border-[var(--cy-orange)] bg-[var(--cy-gray)]"
                        : "border-[var(--border)]"
                    }`}
                  >
                    <span className="font-medium text-[var(--cy-navy)]">{row.name}</span>
                    <span className="text-[var(--muted-foreground)]">{row.roleLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ActionForm
            action={addSchedulingTechnicianAction}
            successMessage="Technician added."
            onSuccess={() => selected && onAdded(selected)}
          >
            <input type="hidden" name="userId" value={selected} />
            <button
              type="submit"
              disabled={!selected}
              className="h-11 w-full rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white disabled:opacity-50"
            >
              Configure availability
            </button>
          </ActionForm>
          <Link href="/team" className="block text-center text-sm text-[var(--muted-foreground)] underline">
            + Invite / create team member
          </Link>
        </div>
      </SheetContent>
    </Sheet>
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
  const [hours, setHours] = useState<Record<number, { working: boolean; start: number; end: number }>>({});

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

  function dayHours(weekday: number) {
    if (hours[weekday]) return hours[weekday];
    const open = data.windows.filter((window) => resolved[keyFor(weekday, window.id)]?.available);
    if (!open.length) return { working: false, start: 8 * 60, end: 17 * 60 };
    return {
      working: true,
      start: Math.min(...open.map((window) => window.startMinutes)),
      end: Math.max(...open.map((window) => window.endMinutes)),
    };
  }

  function setSlot(weekday: number, windowId: string, patch: Partial<{ available: boolean; capacity: number }>) {
    const key = keyFor(weekday, windowId);
    setDraft((current) => ({
      ...current,
      [key]: { ...resolved[key], ...patch },
    }));
  }

  function applyHours(weekday: number, next: { working: boolean; start: number; end: number }) {
    setHours((current) => ({ ...current, [weekday]: next }));
    for (const window of data.windows) {
      const overlaps = window.startMinutes < next.end && next.start < window.endMinutes;
      setSlot(weekday, window.id, {
        available: next.working && overlaps,
        capacity: resolved[keyFor(weekday, window.id)]?.capacity || 1,
      });
    }
  }

  function copyMondayToWeekdays() {
    const monday = dayHours(1);
    for (const weekday of [2, 3, 4, 5]) {
      applyHours(weekday, monday);
      for (const window of data.windows) {
        setSlot(weekday, window.id, resolved[keyFor(1, window.id)]);
      }
    }
  }

  function applyMondayToFriday() {
    const monday = { working: true, start: dayHours(1).start, end: dayHours(1).end };
    for (const weekday of WEEKDAYS) {
      applyHours(weekday, monday);
      for (const window of data.windows) {
        const source = resolved[keyFor(1, window.id)];
        setSlot(weekday, window.id, {
          available: source?.available ?? true,
          capacity: source?.capacity || 1,
        });
      }
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDraft({});
          setHours({});
        }
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className={drawerClass()}>
        <SheetHeader>
          <SheetTitle>{tech?.name}</SheetTitle>
          <SheetDescription>Weekly hours, capacity by window, and service types they can perform.</SheetDescription>
        </SheetHeader>
        {tech ? (
          <div className="px-4 pb-4">
            <ActionForm key={tech.userId} action={saveTechnicianWeekAction} successMessage="Technician schedule saved." className="space-y-5">
              <input type="hidden" name="userId" value={tech.userId} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyMondayToWeekdays} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  Copy Monday to weekdays
                </button>
                <button type="button" onClick={applyMondayToFriday} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  Apply to Mon–Fri
                </button>
              </div>
              {ALL_DAYS.map((weekday) => {
                const day = dayHours(weekday);
                const total = data.windows.reduce((sum, window) => {
                  const slot = resolved[keyFor(weekday, window.id)];
                  return sum + (slot?.available ? slot.capacity : 0);
                }, 0);
                return (
                  <section key={weekday} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm font-semibold text-[var(--cy-navy)]">
                        <input
                          type="checkbox"
                          checked={day.working}
                          onChange={(event) => applyHours(weekday, { ...day, working: event.target.checked })}
                        />
                        {WEEKDAY_LABELS[weekday]}
                      </label>
                      <span className="text-xs text-[var(--muted-foreground)]">Total capacity: {total}</span>
                    </div>
                    {day.working ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-xs text-[var(--muted-foreground)]">
                            Start
                            <select
                              value={String(day.start)}
                              onChange={(event) => applyHours(weekday, { ...day, start: Number(event.target.value) })}
                              className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm text-[var(--cy-navy)]"
                            >
                              {hourOptions().map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 text-xs text-[var(--muted-foreground)]">
                            End
                            <select
                              value={String(day.end)}
                              onChange={(event) => applyHours(weekday, { ...day, end: Number(event.target.value) })}
                              className="h-10 w-full rounded-lg border border-[var(--border)] px-2 text-sm text-[var(--cy-navy)]"
                            >
                              {hourOptions().map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        {data.windows.map((window) => {
                          const key = keyFor(weekday, window.id);
                          const slot = resolved[key];
                          return (
                            <label key={key} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--cy-gray)] px-3 py-2">
                              <span className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  name={`available:${key}`}
                                  value="true"
                                  checked={slot.available}
                                  onChange={(event) => setSlot(weekday, window.id, { available: event.target.checked })}
                                />
                                {formatWindowChip(window.startMinutes, window.endMinutes)}
                              </span>
                              <span className="flex items-center gap-2 text-sm">
                                <button
                                  type="button"
                                  onClick={() => setSlot(weekday, window.id, { capacity: Math.max(0, slot.capacity - 1) })}
                                  className="h-8 w-8 rounded-lg border border-[var(--border)] bg-white"
                                >
                                  −
                                </button>
                                <input
                                  name={`capacity:${key}`}
                                  type="number"
                                  min={0}
                                  value={slot.capacity}
                                  onChange={(event) => setSlot(weekday, window.id, { capacity: Number(event.target.value || 0) })}
                                  className="h-9 w-14 rounded-lg border border-[var(--border)] bg-white px-2 text-center"
                                />
                                <button
                                  type="button"
                                  onClick={() => setSlot(weekday, window.id, { capacity: slot.capacity + 1 })}
                                  className="h-8 w-8 rounded-lg border border-[var(--border)] bg-white"
                                >
                                  +
                                </button>
                              </span>
                            </label>
                          );
                        })}
                      </>
                    ) : (
                      data.windows.map((window) => (
                        <input key={keyFor(weekday, window.id)} type="hidden" name={`capacity:${keyFor(weekday, window.id)}`} value={resolved[keyFor(weekday, window.id)]?.capacity ?? 1} />
                      ))
                    )}
                  </section>
                );
              })}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--cy-navy)]">Can perform</h3>
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
            {tech.role === "COMPANY_OWNER" || tech.role === "ADMIN" || tech.role === "MANAGER" ? (
              <ActionForm action={removeSchedulingTechnicianAction} className="mt-3">
                <input type="hidden" name="userId" value={tech.userId} />
                <button type="submit" className="w-full text-sm text-[var(--muted-foreground)] underline">
                  Remove from scheduling
                </button>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function hourOptions() {
  return Array.from({ length: 24 * 4 }, (_, index) => {
    const minutes = index * 15;
    return { value: minutes, label: formatClockMinutes(minutes) };
  });
}

function ExceptionSheet({
  data,
  open,
  onOpenChange,
}: {
  data: SchedulingSettingsData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [kind, setKind] = useState<ExceptionKind>("PTO");
  const needsStart = kind === "LATE_START" || kind === "EXTRA_HOURS" || kind === "CUSTOM";
  const needsEnd = kind === "EARLY_FINISH" || kind === "EXTRA_HOURS" || kind === "CUSTOM";
  const needsCapacity = kind === "CAPACITY_OVERRIDE" || kind === "EXTRA_HOURS";
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setKind("PTO");
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className={drawerClass()}>
        <SheetHeader>
          <SheetTitle>Add exception</SheetTitle>
          <SheetDescription>Overrides the weekly template immediately in the live availability engine.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <ActionForm
            action={saveAvailabilityOverrideAction}
            successMessage="Exception saved."
            className="space-y-3"
            onSuccess={() => onOpenChange(false)}
          >
            <div className="space-y-1.5">
              <Label>Technician</Label>
              <select name="userId" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                <option value="__all__">All scheduled technicians</option>
                {data.technicians.map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input name="date" type="date" required />
              </div>
              <div className="space-y-1.5">
                <Label>End date (optional)</Label>
                <Input name="endDate" type="date" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Exception type</Label>
              <select
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as ExceptionKind)}
                className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
              >
                {EXCEPTION_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {EXCEPTION_KIND_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            {needsStart ? (
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <ClockFields prefix="start" minutes={kind === "LATE_START" ? 10 * 60 : 8 * 60} />
              </div>
            ) : null}
            {needsEnd ? (
              <div className="space-y-1.5">
                <Label>End time</Label>
                <ClockFields prefix="end" minutes={kind === "EARLY_FINISH" ? 13 * 60 : 13 * 60} />
              </div>
            ) : null}
            {needsCapacity ? (
              <div className="space-y-1.5">
                <Label>Capacity override</Label>
                <Input name="capacity" type="number" min={0} placeholder="Appointments" />
              </div>
            ) : null}
            {kind === "CUSTOM" ? (
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select name="available" defaultValue="yes" className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
                  <option value="yes">Available</option>
                  <option value="no">Unavailable</option>
                </select>
              </div>
            ) : (
              <input type="hidden" name="available" value={kind === "EXTRA_HOURS" || kind === "CAPACITY_OVERRIDE" ? "yes" : "no"} />
            )}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input name="reason" placeholder="Optional note" />
            </div>
            <button type="submit" className="h-11 w-full rounded-lg bg-[var(--cy-navy)] text-sm font-medium text-white">
              Save exception
            </button>
          </ActionForm>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PolicyForm({ data, showAdvanced }: { data: SchedulingSettingsData; showAdvanced: boolean }) {
  return (
    <ActionForm action={saveSchedulingPolicyAction} successMessage="Scheduling rules saved." className="grid gap-3">
      <input type="hidden" name="allowOfficeOverride" value="yes" />
      <div className="space-y-1.5">
        <Label>Auto booking enabled</Label>
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
        <Label>Customer auto-cancel / reschedule</Label>
        <select name="autoCancelEnabled" defaultValue={data.policy.autoCancelEnabled ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
          <option value="no">Office review</option>
          <option value="yes">Auto-cancel allowed</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Standard booking horizon (days)</Label>
        <Input name="standardHorizonDays" type="number" min={1} defaultValue={data.policy.standardHorizonDays} />
      </div>
      <div className="space-y-1.5">
        <Label>Maintenance booking horizon (days)</Label>
        <Input name="maintenanceHorizonDays" type="number" min={1} defaultValue={data.policy.maintenanceHorizonDays} />
      </div>
      <div className="space-y-1.5">
        <Label>Minimum booking notice (minutes)</Label>
        <Input name="minNoticeMinutes" type="number" min={0} defaultValue={data.policy.minNoticeMinutes} />
      </div>
      <div className="space-y-1.5">
        <Label>Emergency reserve per window</Label>
        <Input name="emergencyReservePerWindow" type="number" min={0} defaultValue={data.policy.emergencyReservePerWindow} />
      </div>
      <div className="space-y-1.5">
        <Label>Maximum appointments / day</Label>
        <Input name="maxJobsPerDay" type="number" min={1} defaultValue={data.policy.maxJobsPerDay ?? ""} placeholder="Optional" />
      </div>
      {showAdvanced ? (
        <>
          <div className="space-y-1.5">
            <Label>Company timezone</Label>
            <select name="timezone" defaultValue={data.policy.timezone} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              {[data.policy.timezone, ...TIMEZONES.filter((zone) => zone !== data.policy.timezone)].map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Bookable business hours follow the appointment windows on this page. Default duration is the selected window.
          </p>
          <div className="space-y-1.5">
            <Label>Assignment strategy</Label>
            <select
              name="allowTechnicianPreference"
              defaultValue={data.policy.allowTechnicianPreference ? "yes" : "no"}
              className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
            >
              <option value="yes">Prefer requested technician when eligible</option>
              <option value="no">Always use ranked company capacity</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Max jobs per window</Label>
            <Input name="maxJobsPerWindow" type="number" min={1} defaultValue={data.policy.maxJobsPerWindow ?? ""} placeholder="Overbooking protection" />
          </div>
          <div className="space-y-1.5">
            <Label>Use emergency reserve</Label>
            <select name="allowEmergencyReserveUse" defaultValue={data.policy.allowEmergencyReserveUse ? "yes" : "no"} className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm">
              <option value="no">Hold reserve</option>
              <option value="yes">Allow use</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Unassigned booking policy</Label>
            <p className="rounded-lg bg-[var(--cy-gray)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
              ContractorYou assigns an eligible technician with remaining capacity. Unassigned bookings are not created.
            </p>
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
          <div className="space-y-1.5">
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
      <button type="submit" className="h-11 rounded-lg bg-[var(--cy-navy)] px-4 text-sm font-medium text-white">
        Save changes
      </button>
    </ActionForm>
  );
}
