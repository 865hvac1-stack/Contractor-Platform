import { redirect } from "next/navigation";

export default async function DispatchCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; issue?: string; job?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ view: "dispatch" });
  if (params.date) query.set("date", params.date);
  if (params.job) query.set("job", params.job);
  const legacyIssue = params.issue ?? params.view;
  if (legacyIssue && legacyIssue !== "dispatch" && legacyIssue !== "all") query.set("issue", legacyIssue);
  redirect(`/jobs?${query.toString()}`);
}
