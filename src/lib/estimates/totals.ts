import { lineTotalCents, sumCents } from "@/lib/money";

export function optionTotals(items: { quantity: unknown; unitPriceCents: number }[]) {
  const subtotalCents = sumCents(
    items.map((item) => lineTotalCents(Number(item.quantity), item.unitPriceCents))
  );
  return { subtotalCents, taxCents: 0, totalCents: subtotalCents };
}

export function membershipSavingsCents(items: { standardPriceCents: number; unitPriceCents: number; quantity: unknown }[]) {
  return sumCents(
    items.map((item) => {
      const qty = Number(item.quantity);
      const standard = lineTotalCents(qty, item.standardPriceCents);
      const charged = lineTotalCents(qty, item.unitPriceCents);
      return Math.max(0, standard - charged);
    })
  );
}
