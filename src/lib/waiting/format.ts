import { formatWaitingDate, relativeWaitingDay } from "@/lib/waiting/schedule";

export function waitingSinceLabel(enteredAt: Date, now = new Date()) {
  const days = Math.max(0, Math.floor((now.getTime() - enteredAt.getTime()) / 86_400_000));
  if (days === 0) return "Waiting since today";
  if (days === 1) return "Waiting 1 day";
  return `Waiting ${days} days`;
}

export function commsLabel(input: {
  lastCustomerUpdateAt: Date | null;
  nextCustomerUpdateAt: Date | null;
  communicationStatus: string | null;
  communicationEnabled: boolean;
  now?: Date;
}) {
  if (!input.communicationEnabled) return "Updates off";
  if (input.communicationStatus === "FAILED") return "Update failed";
  if (input.communicationStatus === "BLOCKED") return "Update blocked";
  return relativeWaitingDay(input.lastCustomerUpdateAt, input.now);
}

export { formatWaitingDate, relativeWaitingDay };
