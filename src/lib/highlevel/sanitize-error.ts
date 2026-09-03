export function sanitizeHighLevelErrorMessage(message: string | null | undefined) {
  if (!message) return null;
  return message
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[redacted]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted]")
    .slice(0, 180);
}
