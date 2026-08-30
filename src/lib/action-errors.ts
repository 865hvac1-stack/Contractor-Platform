export function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function publicActionError(error: unknown): string {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : "";

  if (message.includes("SESSION_SECRET")) {
    return "Server is missing SESSION_SECRET. Add a 32+ character secret in Railway Variables, then redeploy.";
  }
  if (code === "P1001" || message.includes("Can't reach database")) {
    return "Cannot reach the database. Confirm DATABASE_URL is set from the Railway Postgres plugin.";
  }
  if (
    code === "P2021" ||
    code === "P2022" ||
    message.includes("does not exist") ||
    message.includes("migration")
  ) {
    return "Database tables are missing. Set the start command to: npx prisma migrate deploy && npm run start";
  }
  if (code === "P2002") {
    return "An account with this email already exists.";
  }

  console.error("[action]", code || "UNKNOWN", message);
  return "Could not complete that request. Check Railway logs, then try again.";
}
