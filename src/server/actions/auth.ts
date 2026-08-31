"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  generateToken,
  getSessionUser,
  hashPassword,
  hashToken,
  setActiveCompany,
  verifyPassword,
} from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { isNextRedirect, publicActionError } from "@/lib/action-errors";
import {
  companyOnboardingSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validators";
import { landingPath } from "@/lib/workspaces";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; setupUrl?: string; diagnostic?: string };

export async function loginAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) return { ok: false, error: "Invalid email or password." };

    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return { ok: false, error: "Invalid email or password." };
    }

    await createSession(user.id);
    await writeAudit({
      actorId: user.id,
      action: "user.login",
      entityType: "User",
      entityId: user.id,
    });

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      include: { company: true },
      orderBy: { createdAt: "asc" },
    });

    if (user.isPlatformAdmin && !membership) {
      redirect("/platform");
    }
    if (!membership) {
      redirect("/onboarding");
    }
    await setActiveCompany(membership.companyId, user.id);
    if (membership.company.status === "ONBOARDING") {
      redirect("/onboarding");
    }
    const next = String(formData.get("next") || "");
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : null;
    if (safeNext) redirect(safeNext);
    redirect(landingPath(membership.role));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return { ok: false, error: publicActionError(error) };
  }
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  await destroySession();
  if (user) {
    await writeAudit({
      actorId: user.id,
      action: "user.logout",
      entityType: "User",
      entityId: user.id,
    });
  }
  redirect("/login?signedOut=1");
}

export async function registerAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      return {
        ok: false,
        error:
          "Server is missing SESSION_SECRET. Add a 32+ character secret in Railway Variables, then redeploy.",
      };
    }

    const parsed = registerSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
    }

    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return { ok: false, error: "An account with this email already exists." };

    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
      },
    });

    await createSession(user.id);
    await writeAudit({
      actorId: user.id,
      action: "user.registered",
      entityType: "User",
      entityId: user.id,
    });

    redirect("/onboarding");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return { ok: false, error: publicActionError(error) };
  }
}

export async function completeOnboardingAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Please sign in." };

  const existingMembership = await prisma.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE" },
  });
  if (existingMembership) {
    redirect("/dashboard");
  }

  const parsed = companyOnboardingSchema.safeParse({
    businessName: formData.get("businessName"),
    legalName: formData.get("legalName") || "",
    industry: formData.get("industry"),
    phone: formData.get("phone") || "",
    email: formData.get("email") || "",
    address: formData.get("address") || "",
    city: formData.get("city") || "",
    state: formData.get("state") || "",
    zip: formData.get("zip") || "",
    timezone: formData.get("timezone") || "America/New_York",
    companySize: formData.get("companySize") || "",
    serviceArea: formData.get("serviceArea") || "",
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid company information." };
  }

  const d = parsed.data;
  const company = await prisma.company.create({
    data: {
      businessName: d.businessName,
      legalName: d.legalName || null,
      industry: d.industry,
      phone: d.phone || null,
      email: d.email || null,
      address: d.address || null,
      city: d.city || null,
      state: d.state || null,
      zip: d.zip || null,
      timezone: d.timezone,
      companySize: d.companySize || null,
      serviceArea: d.serviceArea || null,
      status: "ACTIVE",
      onboardingStep: 5,
      memberships: {
        create: {
          userId: user.id,
          role: "COMPANY_OWNER",
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      },
      numberSequences: {
        create: [
          { kind: "JOB", prefix: "JOB", nextValue: 1 },
          { kind: "ESTIMATE", prefix: "EST", nextValue: 1 },
          { kind: "INVOICE", prefix: "INV", nextValue: 1 },
        ],
      },
    },
  });

  await setActiveCompany(company.id, user.id);
  await writeAudit({
    companyId: company.id,
    actorId: user.id,
    action: "company.created",
    entityType: "Company",
    entityId: company.id,
    metadata: { businessName: company.businessName, industry: company.industry },
  });

  redirect("/dashboard");
}

export async function forgotPasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult & { resetUrl?: string }> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, error: "Enter a valid email." };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  // Always return success to avoid email enumeration
  if (!user) {
    return { ok: true };
  }

  const token = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await writeAudit({
    actorId: user.id,
    action: "user.password_reset_requested",
    entityType: "User",
    entityId: user.id,
  });

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  // Phase 1: no email provider — expose reset URL only in development
  if (process.env.NODE_ENV !== "production") {
    return { ok: true, resetUrl };
  }
  return { ok: true };
}

export async function resetPasswordAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid reset request." };

  const tokenHash = hashToken(parsed.data.token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { ok: false, error: "This reset link is invalid or expired." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);

  await writeAudit({
    actorId: record.userId,
    action: "user.password_reset_completed",
    entityType: "User",
    entityId: record.userId,
  });

  redirect("/login");
}
