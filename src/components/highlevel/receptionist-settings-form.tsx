"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { saveAiReceptionistSettingsAction } from "@/server/actions/receptionist";
import type { ReceptionistSettings } from "@/lib/intelligence/receptionist/types";
import { faqsToFormText } from "@/lib/intelligence/receptionist/v2/knowledge";

export function ReceptionistSettingsForm({ settings }: { settings: ReceptionistSettings }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-white p-5 space-y-4">
      <div>
        <h2 className="font-medium">AI receptionist</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          ContractorYou remains the source of truth for customers, availability, and bookings. This
          setting only controls how ContractorYou drafts or (later) sends the SMS. Do not change the
          conversation owner to switch off HighLevel Regina.
        </p>
      </div>
      <ActionForm action={saveAiReceptionistSettingsAction} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted-foreground)]">Receptionist mode</span>
          <select name="mode" defaultValue={settings.mode} className="w-full rounded-xl border border-[var(--border)] px-3 py-2">
            <option value="HIGHLEVEL_REGINA">HighLevel Regina (production default)</option>
            <option value="CONTRACTORYOU_SHADOW">ContractorYou shadow — propose only, do not send</option>
            <option value="CONTRACTORYOU_AI">ContractorYou AI — live only if ContractorYou owns the conversation</option>
            <option value="OFFICE_ONLY">Office only — ContractorYou AI does not reply</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={settings.enabled} />
          Receptionist enabled
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">Receptionist name</span>
            <input name="assistantName" defaultValue={settings.assistantName} className="w-full rounded-xl border border-[var(--border)] px-3 py-2" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">Tone</span>
            <select name="tone" defaultValue={settings.tone} className="w-full rounded-xl border border-[var(--border)] px-3 py-2">
              <option value="warm">Warm</option>
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted-foreground)]">Response length</span>
            <select name="responseLength" defaultValue={settings.responseLength} className="w-full rounded-xl border border-[var(--border)] px-3 py-2">
              <option value="short">Short SMS (1–3 sentences)</option>
              <option value="medium">Medium</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm sm:mt-6">
            <input type="checkbox" name="useCustomerFirstName" defaultChecked={settings.useCustomerFirstName} />
            Use customer first name occasionally
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted-foreground)]">Company / business description</span>
          <textarea
            name="companyDescription"
            defaultValue={settings.companyDescription ?? ""}
            rows={2}
            className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
          />
        </label>

        <details className="rounded-xl border border-[var(--border)] px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Advanced settings</summary>
          <div className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoReplyInboundSms" defaultChecked={settings.autoReplyInboundSms} />
              Auto-reply to inbound SMS when ContractorYou owns the conversation
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="autoBookServiceCalls" defaultChecked={settings.autoBookServiceCalls} />
              Auto-book service calls when a window is chosen
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="allowSameDayBooking" defaultChecked={settings.allowSameDayBooking} />
              Allow same-day booking when company scheduling rules allow it
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="humanHandoffFallback" defaultChecked={settings.humanHandoffFallback} />
              Hand off to the office when unsure
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Business hours</span>
              <input name="businessHoursText" defaultValue={settings.businessHoursText ?? ""} className="w-full rounded-xl border border-[var(--border)] px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">After-hours behavior</span>
              <select name="afterHoursBehavior" defaultValue={settings.afterHoursBehavior} className="w-full rounded-xl border border-[var(--border)] px-3 py-2">
                <option value="OFFER_CALLBACK">Offer a callback</option>
                <option value="HANDOFF">Flag the office</option>
                <option value="CONTINUE">Keep helping</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">V1 after-hours (legacy)</span>
              <select name="businessHoursBehavior" defaultValue={settings.businessHoursBehavior} className="w-full rounded-xl border border-[var(--border)] px-3 py-2">
                <option value="ALWAYS">Reply any time</option>
                <option value="BUSINESS_HOURS_ONLY">Reply only during business hours</option>
                <option value="AFTER_HOURS_HANDOFF">After hours, flag the office</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Service area</span>
              <input name="serviceAreaNote" defaultValue={settings.serviceAreaNote ?? ""} className="w-full rounded-xl border border-[var(--border)] px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Services offered</span>
              <textarea name="servicesOffered" defaultValue={settings.servicesOffered ?? ""} rows={2} className="w-full rounded-xl border border-[var(--border)] px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Emergency guidance</span>
              <textarea name="emergencyGuidance" defaultValue={settings.emergencyGuidance ?? ""} rows={2} className="w-full rounded-xl border border-[var(--border)] px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Human handoff rules</span>
              <textarea name="handoffRules" defaultValue={settings.handoffRules ?? ""} rows={2} className="w-full rounded-xl border border-[var(--border)] px-3 py-2" />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm text-[var(--muted-foreground)]">Allowed topics</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowScheduling" defaultChecked={settings.allowScheduling} /> Scheduling
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowRescheduling" defaultChecked={settings.allowRescheduling} /> Rescheduling
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowCancellations" defaultChecked={settings.allowCancellations} /> Cancellations
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowJobStatus" defaultChecked={settings.allowJobStatus} /> Job status
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowInvoiceQuestions" defaultChecked={settings.allowInvoiceQuestions} /> Invoice / balance
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowEstimateQuestions" defaultChecked={settings.allowEstimateQuestions} /> Estimates
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowMembershipQuestions" defaultChecked={settings.allowMembershipQuestions} /> Memberships
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="allowWaitingQuestions" defaultChecked={settings.allowWaitingQuestions} /> Waiting / parts
              </label>
            </fieldset>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--muted-foreground)]">Company FAQs (one per line: question | answer)</span>
              <textarea
                name="knowledgeFaqs"
                defaultValue={faqsToFormText(settings.knowledgeJson)}
                rows={4}
                className="w-full rounded-xl border border-[var(--border)] px-3 py-2"
                placeholder="Do you work on Trane? | Yep, we service Trane and most major brands."
              />
            </label>
          </div>
        </details>
        <Button type="submit">Save receptionist</Button>
      </ActionForm>
    </section>
  );
}
