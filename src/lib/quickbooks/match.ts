import { canonicalizeUsPhone } from "@/lib/phone";

export type CustomerMatchInput = {
  firstName: string;
  lastName: string;
  businessName?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type QboCustomerCandidate = {
  id: string;
  displayName: string;
  givenName?: string | null;
  familyName?: string | null;
  email?: string | null;
  phone?: string | null;
};

export type CustomerMatchDecision =
  | { outcome: "LINKED"; quickbooksId: string; score: number; reason: string }
  | { outcome: "NEEDS_REVIEW"; candidates: Array<QboCustomerCandidate & { score: number }>; reason: string }
  | { outcome: "CREATE"; reason: string }
  | { outcome: "NONE"; reason: string };

function normalizeName(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeEmail(value?: string | null) {
  const email = (value || "").trim().toLowerCase();
  return email.includes("@") ? email : "";
}

export function scoreCustomerCandidate(local: CustomerMatchInput, remote: QboCustomerCandidate) {
  let score = 0;
  const reasons: string[] = [];
  const localPhone = canonicalizeUsPhone(local.phone);
  const remotePhone = canonicalizeUsPhone(remote.phone);
  const localEmail = normalizeEmail(local.email);
  const remoteEmail = normalizeEmail(remote.email);
  const localBusiness = normalizeName(local.businessName);
  const remoteName = normalizeName(remote.displayName);
  const localPerson = normalizeName(`${local.firstName} ${local.lastName}`);
  const remotePerson = normalizeName(`${remote.givenName || ""} ${remote.familyName || ""}`) || remoteName;

  if (localPhone && remotePhone && localPhone === remotePhone) {
    score += 40;
    reasons.push("phone");
  }
  if (localEmail && remoteEmail && localEmail === remoteEmail) {
    score += 40;
    reasons.push("email");
  }
  if (localBusiness && localBusiness === remoteName) {
    score += 15;
    reasons.push("business name");
  }
  if (localPerson && localPerson === remotePerson) {
    score += 10;
    reasons.push("person name");
  }
  return { score, reasons };
}

export function decideCustomerMatch(
  local: CustomerMatchInput,
  candidates: QboCustomerCandidate[],
  mode: "auto" | "manual"
): CustomerMatchDecision {
  const scored = candidates
    .map((candidate) => ({ ...candidate, ...scoreCustomerCandidate(local, candidate) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const uniqueHigh = best && best.score >= 70 && scored.filter((row) => row.score >= 70).length === 1;
  if (uniqueHigh && best) {
    return {
      outcome: "LINKED",
      quickbooksId: best.id,
      score: best.score,
      reason: `Matched on ${best.reasons.join(" and ")}.`,
    };
  }
  if (scored.length) {
    return {
      outcome: "NEEDS_REVIEW",
      candidates: scored,
      reason: scored[0]?.score < 40
        ? "Name-only matches are not linked automatically."
        : "More than one QuickBooks customer could match. Review before linking.",
    };
  }
  if (mode === "manual") {
    return { outcome: "CREATE", reason: "No QuickBooks customer matched. You can create one." };
  }
  return { outcome: "NONE", reason: "Customer needs to be linked before invoice can sync." };
}
