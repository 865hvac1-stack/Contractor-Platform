"use client";

import { useEffect, useState } from "react";
import type { FormFieldDef } from "@/lib/integrations/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PublicLeadForm({
  formId,
  fields,
  utm,
  landingPageId,
  submitLabel = "Send request",
}: {
  formId: string;
  fields: FormFieldDef[];
  utm?: Record<string, string | undefined>;
  landingPageId?: string;
  submitLabel?: string;
}) {
  const [referrer, setReferrer] = useState("");
  const [page, setPage] = useState("");

  useEffect(() => {
    setReferrer(document.referrer || "");
    setPage(window.location.href);
  }, []);

  return (
    <form action={`/api/forms/${formId}/submit`} method="post" className="space-y-3">
      <input type="text" name="company_website" tabIndex={-1} autoComplete="off" className="hidden" />
      {landingPageId ? <input type="hidden" name="landingPageId" value={landingPageId} /> : null}
      <input type="hidden" name="utm_source" value={utm?.utm_source || ""} />
      <input type="hidden" name="utm_medium" value={utm?.utm_medium || ""} />
      <input type="hidden" name="utm_campaign" value={utm?.utm_campaign || ""} />
      <input type="hidden" name="utm_content" value={utm?.utm_content || ""} />
      <input type="hidden" name="utm_term" value={utm?.utm_term || ""} />
      <input type="hidden" name="referrer" value={referrer} />
      <input type="hidden" name="landing_page" value={page} />
      <input type="hidden" name="submission_page" value={page} />
      {fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <Label htmlFor={field.key}>
            {field.label}
            {field.required ? " *" : ""}
          </Label>
          {field.type === "textarea" ? (
            <Textarea id={field.key} name={field.key} required={field.required} rows={4} />
          ) : (
            <Input
              id={field.key}
              name={field.key}
              type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
              required={field.required}
            />
          )}
        </div>
      ))}
      <Button type="submit" className="h-11 w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
