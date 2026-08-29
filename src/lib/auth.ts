import { createHash, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { Company, CompanyRole, Membership, User } from "@prisma/client";

export const SESSION_COOKIE = "cp_session";
const SESSION_DAYS = 14;

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
};

export type TenantContext = {
  user: AuthUser;
  company: Company;
  membership: Membership;
  role: CompanyRole;
};

function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a string of at least 32 characters");
  }
  return secret;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).update(requireSessionSecret()).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSession(
  userId: string,
  meta?: { ipAddress?: string; userAgent?: string }
): Promise<string> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = hashToken(token);
    await prisma.session.deleteMany({ where: { tokenHash } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    }
    return null;
  }

  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    isPlatformAdmin: u.isPlatformAdmin,
  };
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new AuthError("Unauthorized", 401);
  }
  return user;
}

/**
 * Resolve the active company for the current user.
 * Never trusts a client-supplied companyId without verifying membership.
 */
export async function getTenantContext(companyIdHint?: string): Promise<TenantContext | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const cookieStore = await cookies();
  const activeCompanyId = companyIdHint || cookieStore.get("cp_company")?.value;

  let membership = activeCompanyId
    ? await prisma.membership.findFirst({
        where: {
          userId: user.id,
          companyId: activeCompanyId,
          status: "ACTIVE",
        },
        include: { company: true },
      })
    : null;

  if (!membership) {
    membership = await prisma.membership.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      include: { company: true },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!membership) return null;

  return {
    user,
    company: membership.company,
    membership,
    role: membership.role,
  };
}

export async function requireTenant(companyIdHint?: string): Promise<TenantContext> {
  const ctx = await getTenantContext(companyIdHint);
  if (!ctx) {
    throw new AuthError("No active company membership", 403);
  }
  if (ctx.company.status === "SUSPENDED") {
    throw new AuthError("Company is suspended", 403);
  }
  return ctx;
}

export async function setActiveCompany(companyId: string, userId: string): Promise<void> {
  const membership = await prisma.membership.findFirst({
    where: { companyId, userId, status: "ACTIVE" },
  });
  if (!membership) {
    throw new AuthError("Not a member of this company", 403);
  }
  const cookieStore = await cookies();
  cookieStore.set("cp_company", companyId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function requirePlatformAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) {
    throw new AuthError("Platform admin required", 403);
  }
  return user;
}

export function assertSameCompany(recordCompanyId: string, tenantCompanyId: string): void {
  if (recordCompanyId !== tenantCompanyId) {
    throw new AuthError("Cross-tenant access denied", 403);
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
