/** Integer-cent money helpers. Never use floats for currency. */

export function dollarsToCents(dollars: number | string): number {
  const n = typeof dollars === "string" ? parseFloat(dollars) : dollars;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(centsToDollars(cents));
}

export function formatMoneyCompact(cents: number, currency = "USD"): string {
  const dollars = centsToDollars(cents);
  if (Math.abs(dollars) >= 10_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(dollars);
  }
  return formatMoney(cents, currency);
}

export function lineTotalCents(quantity: number | string, unitPriceCents: number): number {
  const q = typeof quantity === "string" ? parseFloat(quantity) : quantity;
  if (!Number.isFinite(q)) return 0;
  return Math.round(q * unitPriceCents);
}

export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0);
}
