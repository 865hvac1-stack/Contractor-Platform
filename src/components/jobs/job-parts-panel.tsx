import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import {
  addJobPartAction,
  cancelJobPartAction,
  installJobPartAction,
  pickUpJobPartAction,
  reserveJobPartAction,
} from "@/server/actions/job-parts";

type PartOption = {
  id: string;
  name: string;
  sku: string | null;
  internalCostCents: number | null;
};

type Stock = {
  id: string;
  partId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  minimumStock: number;
  location: { name: string };
};

type JobPartRow = {
  id: string;
  partId: string;
  quantity: number;
  status: string;
  unitCostCents: number;
  notes: string | null;
  part: { name: string; sku: string | null };
  location: { name: string } | null;
};

export function JobPartsPanel({
  jobId,
  parts,
  stocks,
  jobParts,
  canAdd,
  canReserve,
  canUse,
  showCost = true,
}: {
  jobId: string;
  parts: PartOption[];
  stocks: Stock[];
  jobParts: JobPartRow[];
  canAdd: boolean;
  canReserve: boolean;
  canUse: boolean;
  showCost?: boolean;
}) {
  const unavailable = jobParts.filter((row) => {
    if (row.status !== "NEEDED") return false;
    return stocks.filter((stock) => stock.partId === row.partId).reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0) < row.quantity;
  }).length;
  return (
    <section id="parts" className="scroll-mt-20 rounded-2xl border border-[var(--border)] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Job 360</p>
          <h2 className="font-display text-xl tracking-tight">Parts & Materials</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Needed → Reserved → Picked Up → Installed → Inventory and job cost updated.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${unavailable ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>
          {unavailable ? `${unavailable} part${unavailable === 1 ? "" : "s"} not available` : jobParts.length ? "Parts ready or tracked" : "No parts required"}
        </span>
      </div>

      {canAdd ? (
        parts.length ? (
          <ActionForm action={addJobPartAction} className="mt-4 grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
            <input type="hidden" name="jobId" value={jobId} />
            <select name="partId" className="h-10 rounded-lg border border-input bg-white px-3 text-sm" required>
              <option value="">Search/choose a Parts Bank item</option>
              {parts.map((part) => (
                <option key={part.id} value={part.id}>
                    {part.name}{part.sku ? ` · ${part.sku}` : ""}{showCost && part.internalCostCents != null ? ` · cost ${formatMoney(part.internalCostCents)}` : ""}
                </option>
              ))}
            </select>
            <Input name="quantity" type="number" min="1" step="1" defaultValue="1" required />
            <Button type="submit">Add Part</Button>
          </ActionForm>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted-foreground)]">
            No active materials or products exist in Parts Bank.
          </p>
        )
      ) : null}

      {jobParts.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">No parts are required for this job.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {jobParts.map((row) => {
            const matchingStocks = stocks.filter((stock) => stock.partId === row.partId);
            const materialCost = row.unitCostCents * row.quantity;
            return (
              <li key={row.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{row.part.name} · Qty {row.quantity}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {row.part.sku ? `SKU ${row.part.sku} · ` : ""}{row.location?.name || "No location"}
                      {showCost ? ` · Job material cost ${formatMoney(materialCost)}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--cy-gray)] px-2.5 py-1 text-xs font-medium">{row.status.replaceAll("_", " ")}</span>
                </div>
                {row.status === "NEEDED" && canReserve ? (
                  matchingStocks.length ? (
                    <ActionForm action={reserveJobPartAction} className="mt-3 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="jobPartId" value={row.id} />
                      <label className="text-xs">Reserve from
                        <select name="locationId" className="mt-1 block h-9 rounded-lg border border-input bg-white px-2 text-sm">
                          {matchingStocks.map((stock) => (
                            <option key={stock.id} value={stock.locationId} disabled={stock.onHand - stock.reserved < row.quantity}>
                              {stock.location.name} · {stock.onHand - stock.reserved} available
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button type="submit" size="sm" variant="outline">Reserve</Button>
                    </ActionForm>
                  ) : <p className="mt-2 text-xs font-medium text-rose-700">PART NOT AVAILABLE — no stock location has this item.</p>
                ) : null}
                {row.status === "RESERVED" && canUse ? (
                  <ActionForm action={pickUpJobPartAction} className="mt-3">
                    <input type="hidden" name="jobPartId" value={row.id} />
                    <Button type="submit" size="sm" variant="outline">Mark Picked Up / On Truck</Button>
                  </ActionForm>
                ) : null}
                {["RESERVED", "PICKED_UP"].includes(row.status) && canUse ? (
                  <ActionForm action={installJobPartAction} className="mt-2">
                    <input type="hidden" name="jobPartId" value={row.id} />
                    <Button type="submit" size="sm">Mark Installed</Button>
                  </ActionForm>
                ) : null}
                {canUse ? (
                  <ActionForm action={cancelJobPartAction} className="mt-2">
                    <input type="hidden" name="jobPartId" value={row.id} />
                    <Button type="submit" size="sm" variant="ghost">Remove / Correct Usage</Button>
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
