"use client";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitSupportRequestAction } from "@/server/actions/support";

export function SupportContactForm({
  name,
  company,
  email,
  supportAddress,
  emailConfigured,
}: {
  name: string;
  company: string;
  email: string;
  supportAddress: string;
  emailConfigured: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold text-[var(--cy-navy)]">Contact ContractorYou Support</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {emailConfigured
            ? "Send a message from this workspace. We use your signed-in name, company, and email."
            : `Messages cannot be delivered from this server until email is configured. Use ${supportAddress} in the meantime.`}
        </p>
      </div>
      <ActionForm action={submitSupportRequestAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="support-name">Name</Label>
            <Input id="support-name" value={name} readOnly />
          </div>
          <div className="space-y-1">
            <Label htmlFor="support-company">Company</Label>
            <Input id="support-company" value={company} readOnly />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="support-email">Email</Label>
          <Input id="support-email" value={email} readOnly />
        </div>
        <div className="space-y-1">
          <Label htmlFor="support-subject">Subject</Label>
          <Input id="support-subject" name="subject" required maxLength={120} autoComplete="off" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="support-message">Message</Label>
          <Textarea id="support-message" name="message" required minLength={10} rows={6} />
        </div>
        <Button type="submit" disabled={!emailConfigured}>
          Send to support
        </Button>
      </ActionForm>
      <p className="text-sm text-[var(--muted-foreground)]">
        Or email{" "}
        <a href={`mailto:${supportAddress}`} className="font-medium text-[var(--cy-navy)] underline-offset-4 hover:underline">
          {supportAddress}
        </a>
        .
      </p>
    </div>
  );
}
