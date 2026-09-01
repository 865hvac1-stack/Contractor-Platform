import type { ToolName } from "@/lib/intelligence/tools";

export function toolsForQuestion(question: string, jobId?: string | null, customerId?: string | null): ToolName[] {
  const q = question.toLowerCase();
  const tools = new Set<ToolName>();
  if (customerId) {
    tools.add("getCustomerSummary");
  }
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
  if (/owe|overdue|invoice|money|collect|receivable|outstanding/.test(q)) {
    tools.add("getOutstandingInvoices");
    tools.add("getPaymentCollection");
  }
  if (/failed payment|declined|payment failed/.test(q)) tools.add("getFailedPayments");
  if (/processing|ach|bank payment/.test(q)) tools.add("getProcessingPayments");
  if (/collected today|collected this|paid today|how much did we collect/.test(q)) {
    tools.add("getPaymentCollection");
  }
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
  if (/margin|job type|service type|service call|changeout|residential service|profitable/.test(q)) {
    tools.add("getMarginByJobType");
  }
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
  if (/business health|health only|why is (my|our) health|why is (my|our) business/.test(q)) {
    tools.add("getBusinessHealth");
    tools.add("getOperatingNotes");
  }
  if (/how are we|this month|this week|summary|happening/.test(q)) tools.add("getBusinessSummary");
  if (/drive|route|unassigned|fit another|dispatch|late/.test(q)) {
    tools.add("getDispatchWorkload");
    tools.add("getRouteOptimizationSavings");
  }
  if (tools.size === 0) {
    if (customerId) {
      tools.add("getCustomerSummary");
    } else {
      tools.add("getTopInsights");
      tools.add("getBusinessSummary");
    }
  }
  return [...tools].slice(0, 4);
}

export function suggestedQuestions(role: string, jobId?: string | null, workspace?: string) {
  if (jobId) {
    return [
      "What do I still need on this job?",
      "What did we make on this job?",
      "Why was this job margin low?",
      "What should happen next?",
    ];
  }
  if (role === "TECHNICIAN" || role === "INSTALLER" || workspace === "field") {
    return [
      "What jobs do I have today?",
      "What is my scorecard this week?",
      "What incentives are pending?",
      "What does the Playbook require?",
    ];
  }
  if (workspace === "dispatch") {
    return [
      "Who is running late?",
      "Which technician has room today?",
      "What jobs are still unassigned?",
      "Who should take the next no-cooling call?",
      "Where are today's schedule conflicts?",
    ];
  }
  if (workspace === "office") {
    return [
      "Which customers need follow-up?",
      "Which estimates are still open?",
      "Who has an unpaid invoice?",
      "What should I do next for this customer?",
    ];
  }
  if (workspace === "intelligence") {
    return [
      "Why is my business health only 60?",
      "What should I do about it?",
      "What changed in my business this month?",
      "Which estimates should I follow up on?",
      "Who owes us the most money?",
      "Which technicians have the most callbacks?",
      "Where are our best leads coming from?",
      "Which customers should become members?",
      "How are we doing against our goals?",
      "What should I focus on today?",
    ];
  }
  return [
    "Take care of my estimate follow-ups.",
    "Who owes us money?",
    "Handle overdue invoices.",
    "Which jobs are losing money?",
    "Follow up with memberships expiring this month.",
    "Fix tomorrow's unassigned jobs.",
    "How is my team performing?",
    "What needs my attention today?",
  ];
}
