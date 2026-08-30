import type { ToolName } from "@/lib/intelligence/tools";

export function toolsForQuestion(question: string, jobId?: string | null): ToolName[] {
  const q = question.toLowerCase();
  const tools = new Set<ToolName>();
  if (jobId) {
    tools.add("getJobSummary");
    tools.add("getPlaybookStatus");
  }
  if (/attention|focus|today|need/.test(q)) {
    tools.add("getTopInsights");
    tools.add("getTodaySchedule");
  }
  if (/tomorrow|schedule/.test(q)) tools.add("getTodaySchedule");
  if (/estimate|follow.?up|sold|close/.test(q)) {
    tools.add("getOpenEstimates");
    tools.add("getEstimateFollowUpOpportunities");
  }
  if (/owe|overdue|invoice|money|collect|receivable/.test(q)) tools.add("getOutstandingInvoices");
  if (/lead|source|marketing|google|facebook|lsa|ads|organic/.test(q)) {
    tools.add("getLeadMetrics");
    tools.add("getMarketingPerformance");
  }
  if (/job|playbook|paperwork|required|still need/.test(q)) {
    tools.add("getJobSummary");
    tools.add("getPlaybookStatus");
  }
  if (/review/.test(q)) tools.add("getReviewMetrics");
  if (/expense|cost|profit|margin|revenue/.test(q)) {
    tools.add("getRevenueMetrics");
    tools.add("getExpenseSummary");
  }
  if (/customer|call back|repeat/.test(q)) tools.add("getOpportunities");
  if (/trend|better|worse|compared|down|up/.test(q)) tools.add("getTrend");
  if (/how are we|this month|this week|summary|happening/.test(q)) tools.add("getBusinessSummary");
  if (tools.size === 0) {
    tools.add("getTopInsights");
    tools.add("getBusinessSummary");
  }
  return [...tools].slice(0, 4);
}

export function suggestedQuestions(role: string, jobId?: string | null) {
  if (jobId) {
    return [
      "What do I still need on this job?",
      "Summarize this job.",
      "What does this Playbook require?",
      "What should happen next?",
    ];
  }
  if (role === "TECHNICIAN" || role === "INSTALLER") {
    return [
      "What jobs do I have today?",
      "What do I still need on my current jobs?",
      "What does the Playbook require?",
    ];
  }
  return [
    "What needs my attention today?",
    "What estimates should I follow up?",
    "Who owes us money?",
    "How are we doing this month?",
    "Where are our leads coming from?",
    "What should I focus on?",
  ];
}
