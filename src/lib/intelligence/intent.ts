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
    tools.add("getJobProfitability");
    tools.add("getLowMarginJobs");
  }
  if (/receipt|inbox|unassigned|duplicate/.test(q)) {
    tools.add("getUnassignedReceipts");
    tools.add("getReceiptSummary");
  }
  if (/fuel|truck|vehicle/.test(q)) tools.add("getVehicleExpenses");
  if (/margin|job type|profitable/.test(q)) tools.add("getMarginByJobType");
  if (/missing cost|no cost/.test(q)) tools.add("getJobsMissingCosts");
  if (jobId && /make|profit|margin|cost/.test(q)) {
    tools.add("getJobProfitability");
    tools.add("getJobCostBreakdown");
  }
  if (/customer|call back|repeat/.test(q)) tools.add("getOpportunities");
  if (/trend|better|worse|compared|down|up/.test(q)) tools.add("getTrend");
  if (/scorecard|technician|best tech|average ticket|close rate|membership/.test(q)) {
    tools.add("getTechnicianScorecard");
    tools.add("getTeamPerformance");
    tools.add("getMembershipSales");
    tools.add("getAverageTicket");
    tools.add("getCloseRate");
  }
  if (/incentive|compensation|commission|owe|payout/.test(q)) {
    tools.add("getCompensationSummary");
    tools.add("getPendingCompensation");
  }
  if (/pricebook|which service|highest margin|item sold/.test(q)) {
    tools.add("getPricebookPerformance");
    tools.add("getPricebookItemPerformance");
  }
  if (/who sold|revenue by|produced/.test(q)) tools.add("getRevenueByTechnician");
  if (/margin by technician|gross profit/.test(q)) tools.add("getMarginByTechnician");
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
      "What did we make on this job?",
      "Why was this job margin low?",
      "What should happen next?",
    ];
  }
  if (role === "TECHNICIAN" || role === "INSTALLER") {
    return [
      "What jobs do I have today?",
      "What is my scorecard this week?",
      "What incentives are pending?",
      "What does the Playbook require?",
    ];
  }
  return [
    "What needs my attention today?",
    "Who sold the most memberships?",
    "How much incentive compensation do we owe this week?",
    "Which Pricebook items make us the most money?",
    "Who has the highest close rate?",
    "How are we doing this month?",
  ];
}
