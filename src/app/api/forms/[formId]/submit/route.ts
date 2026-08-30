import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createLeadFromWebsiteForm, parseFields } from "@/lib/integrations/forms";

const recent = new Map<string, number>();

function rateLimited(key: string) {
  const now = Date.now();
  const last = recent.get(key) ?? 0;
  if (now - last < 8000) return true;
  recent.set(key, now);
  return false;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ formId: string }> }
) {
  const { formId } = await context.params;
  const form = await prisma.websiteForm.findFirst({ where: { id: formId, status: "ACTIVE" } });
  if (!form) return NextResponse.json({ ok: false, error: "Form not found." }, { status: 404 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(`${formId}:${ip}`)) {
    return NextResponse.json({ ok: false, error: "Please wait a moment and try again." }, { status: 429 });
  }

  const contentType = request.headers.get("content-type") || "";
  const values: Record<string, string> = {};
  let landingPageId: string | null = null;
  if (contentType.includes("application/json")) {
    const json = (await request.json()) as Record<string, string>;
    Object.assign(values, json);
    landingPageId = json.landingPageId || null;
  } else {
    const data = await request.formData();
    for (const [key, value] of data.entries()) {
      if (typeof value === "string") values[key] = value;
    }
    landingPageId = values.landingPageId || null;
  }

  if (values.company_website) {
    return NextResponse.json({ ok: true });
  }

  const fields = parseFields(form.fields);
  for (const field of fields) {
    if (field.required && !String(values[field.key] || "").trim()) {
      return NextResponse.json({ ok: false, error: `${field.label} is required.` }, { status: 400 });
    }
  }

  const result = await createLeadFromWebsiteForm({
    formId,
    values,
    landingPageId,
    utm: {
      utmSource: values.utm_source,
      utmMedium: values.utm_medium,
      utmCampaign: values.utm_campaign,
      utmContent: values.utm_content,
      utmTerm: values.utm_term,
      referrer: values.referrer || request.headers.get("referer"),
      landingPage: values.landing_page,
      submissionPage: values.submission_page || request.headers.get("referer"),
    },
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  if (contentType.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }
  const thanks = new URL(`/f/${formId}?thanks=1`, request.url);
  return NextResponse.redirect(thanks, 303);
}
