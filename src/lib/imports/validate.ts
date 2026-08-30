import type { MappedCustomer, RowIssue } from "@/lib/imports/types";
import { isValidEmail, normalizeState } from "@/lib/imports/normalize";

export function validateMappedCustomer(mapped: MappedCustomer): {
  issues: RowIssue[];
  status: "VALID" | "WARNING" | "ERROR";
} {
  const issues: RowIssue[] = [];
  if (!mapped.firstName && !mapped.lastName && !mapped.businessName) {
    issues.push({
      level: "ERROR",
      code: "missing_name",
      message: "This row needs a customer name or a company name.",
      field: "firstName",
    });
  }
  if (mapped.email && !isValidEmail(mapped.email)) {
    issues.push({
      level: "ERROR",
      code: "invalid_email",
      message: "The email address does not look valid.",
      field: "email",
    });
  }
  if (mapped.phone && mapped.phone.replace(/\D/g, "").length < 7) {
    issues.push({
      level: "WARNING",
      code: "bad_phone",
      message: "The phone number looks incomplete.",
      field: "phone",
    });
  }
  for (const property of mapped.properties) {
    if (!property.address || property.address === "Address not provided") {
      issues.push({
        level: "WARNING",
        code: "incomplete_address",
        message: "A service location is missing a street address.",
        field: "address",
      });
    }
    if (property.state && property.state !== "NA" && !normalizeState(property.state).recognized) {
      issues.push({
        level: "WARNING",
        code: "unrecognized_state",
        message: `We did not recognize the state “${property.state}”. It will still be imported.`,
        field: "state",
      });
    }
  }
  const hasError = issues.some((issue) => issue.level === "ERROR");
  const hasWarning = issues.some((issue) => issue.level === "WARNING");
  return {
    issues,
    status: hasError ? "ERROR" : hasWarning ? "WARNING" : "VALID",
  };
}
