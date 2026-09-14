import { requirePermission } from "@/lib/tenant";
import { prisma } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { searchPricebookWhere } from "@/lib/pricebook/pricing";
import {
  createPricebookCategoryAction,
  createPricebookItemAction,
  updatePricebookCategoryAction,
  updatePricebookItemAction,
} from "@/server/actions/pricebook";
import { ActionForm } from "@/components/action-form";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createInventoryLocationAction, receiveInventoryAction } from "@/server/actions/inventory";

const TYPES = ["SERVICE", "PRODUCT", "MATERIAL", "ADD_ON", "MEMBERSHIP", "BUNDLE", "OTHER"] as const;

export default async function PricebookPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const ctx = await requirePermission("pricebook:view");
  const params = await searchParams;
  const canManage = can(ctx.role, "pricebook:manage");
  const canCost = can(ctx.role, "pricebook:cost");
  const q = params.q ?? "";
  const categoryId = params.category || "";

  const [categories, items, locations] = await Promise.all([
    prisma.pricebookCategory.findMany({
      where: { companyId: ctx.company.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.pricebookItem.findMany({
      where: {
        ...searchPricebookWhere(ctx.company.id, q),
        ...(categoryId ? { categoryId } : {}),
        ...(q ? {} : { active: undefined }),
      },
      include: {
        category: true,
        inventoryStocks: {
          include: { location: { select: { id: true, name: true, type: true } } },
          orderBy: { location: { name: "asc" } },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 200,
    }),
    prisma.inventoryLocation.findMany({
      where: { companyId: ctx.company.id, active: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cy-orange)]">Parts Bank</p>
        <h1 className="font-display text-3xl tracking-tight">Pricebook & Inventory</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Office manages services and products. Technicians add them to estimates from the job.
        </p>
      </div>

      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name, SKU, description…" className="max-w-sm" />
        <select
          name="category"
          defaultValue={categoryId}
          className="h-8 rounded-lg border border-input px-2.5 text-sm"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.archived ? " (archived)" : ""}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>

      <section className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[var(--cy-navy)]">Inventory locations</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Tenant-configured warehouses and trucks. Reservations reduce available stock without deducting on-hand quantity.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {locations.map((location) => (
              <span key={location.id} className="rounded-full bg-[var(--cy-gray)] px-3 py-1 text-xs font-medium">
                {location.name} · {location.type.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
        {locations.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted-foreground)]">
            No inventory locations configured. Add a warehouse or truck before receiving stock.
          </p>
        ) : null}
        {canManage ? (
          <ActionForm action={createInventoryLocationAction} className="mt-4 flex flex-wrap gap-2">
            <Input name="name" placeholder="Main Warehouse or Truck name" className="max-w-xs" required />
            <select name="type" className="h-8 rounded-lg border border-input px-2.5 text-sm" defaultValue="WAREHOUSE">
              <option value="WAREHOUSE">Warehouse</option>
              <option value="TRUCK">Truck</option>
              <option value="OTHER">Other</option>
            </select>
            <Button type="submit" size="sm">Add location</Button>
          </ActionForm>
        ) : null}
      </section>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm
            action={createPricebookCategoryAction}
            successMessage="Category saved."
            className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
          >
            <h2 className="font-medium">New category</h2>
            <Input name="name" placeholder="Cooling, Plumbing, Memberships…" required />
            <select name="parentId" className="h-8 w-full rounded-lg border border-input px-2.5 text-sm">
              <option value="">No parent</option>
              {categories
                .filter((category) => !category.parentId)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
            <Button type="submit" size="sm">
              Add category
            </Button>
          </ActionForm>
          <ActionForm
            action={createPricebookItemAction}
            successMessage="Item saved."
            className="space-y-3 rounded-xl border border-[var(--border)] bg-white p-4"
          >
            <h2 className="font-medium">New item</h2>
            <Input name="name" placeholder="Customer-facing name" required />
            <Input name="internalName" placeholder="Internal name (optional)" />
            <Input name="sku" placeholder="SKU (optional)" />
            <select name="categoryId" required className="h-8 w-full rounded-lg border border-input px-2.5 text-sm">
              <option value="">Category</option>
              {categories
                .filter((category) => !category.archived)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
            <select name="type" className="h-8 w-full rounded-lg border border-input px-2.5 text-sm" defaultValue="SERVICE">
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <Input name="standardPrice" type="number" min="0" step="0.01" placeholder="Standard price" required />
            <Input name="memberPrice" type="number" min="0" step="0.01" placeholder="Member price (optional)" />
            {canCost ? (
              <Input name="internalCost" type="number" min="0" step="0.01" placeholder="Internal cost (office only)" />
            ) : null}
            <Input name="customerDescription" placeholder="Customer description" />
            <Input name="technicianNotes" placeholder="Technician notes" />
            <Button type="submit" size="sm">
              Add item
            </Button>
          </ActionForm>
        </div>
      ) : null}

      {categories.length === 0 ? (
        <EmptyState
          title="No Pricebook items yet."
          description="Create a category, then add services, products, add-ons, or memberships. Nothing is seeded."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No matching Pricebook items."
          description="Try another search, or add an item to this category."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-[var(--border)] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {item.category.name} · {item.type.replaceAll("_", " ")}
                    {item.sku ? ` · ${item.sku}` : ""}
                    {item.active ? "" : " · Archived"}
                  </p>
                  {item.customerDescription ? (
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">{item.customerDescription}</p>
                  ) : null}
                </div>
                <div className="text-right text-sm tabular-nums">
                  <p>{formatMoney(item.standardPriceCents)}</p>
                  {item.memberPriceCents != null ? (
                    <p className="text-xs text-emerald-700">Member {formatMoney(item.memberPriceCents)}</p>
                  ) : null}
                  {canCost && item.internalCostCents != null ? (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      Est. cost {formatMoney(item.internalCostCents)}
                    </p>
                  ) : null}
                  {["MATERIAL", "PRODUCT"].includes(item.type) ? (
                    <p className={`text-xs font-medium ${
                      item.inventoryStocks.some((stock) => stock.onHand - stock.reserved < stock.minimumStock)
                        ? "text-amber-700"
                        : "text-emerald-700"
                    }`}>
                      {item.inventoryStocks.reduce((sum, stock) => sum + stock.onHand, 0)} on hand ·{" "}
                      {item.inventoryStocks.reduce((sum, stock) => sum + stock.reserved, 0)} reserved ·{" "}
                      {item.inventoryStocks.reduce((sum, stock) => sum + stock.onHand - stock.reserved, 0)} available
                      {item.inventoryStocks.some((stock) => stock.onHand - stock.reserved < stock.minimumStock) ? " · LOW STOCK" : ""}
                    </p>
                  ) : null}
                </div>
              </div>
              {["MATERIAL", "PRODUCT"].includes(item.type) && item.inventoryStocks.length ? (
                <ul className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  {item.inventoryStocks.map((stock) => (
                    <li key={stock.id} className="rounded-lg bg-[var(--cy-gray)] px-3 py-2">
                      <span className="font-medium">{stock.location.name}</span>: {stock.onHand} on hand · {stock.reserved} reserved · {stock.onHand - stock.reserved} available
                    </li>
                  ))}
                </ul>
              ) : null}
              {canManage && ["MATERIAL", "PRODUCT"].includes(item.type) && locations.length ? (
                <ActionForm action={receiveInventoryAction} className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="partId" value={item.id} />
                  <label className="text-xs">Location
                    <select name="locationId" className="mt-1 block h-8 rounded-lg border border-input px-2.5 text-sm" required>
                      {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                    </select>
                  </label>
                  <label className="text-xs">Receive
                    <Input name="quantity" type="number" min="1" step="1" className="mt-1 w-24" required />
                  </label>
                  <label className="text-xs">Minimum
                    <Input name="minimumStock" type="number" min="0" step="1" className="mt-1 w-24" defaultValue="0" required />
                  </label>
                  <Button type="submit" size="sm" variant="outline">Receive stock</Button>
                </ActionForm>
              ) : null}
              {canManage ? (
                <ActionForm
                  action={updatePricebookItemAction}
                  className="mt-3 grid gap-2 sm:grid-cols-4"
                  successMessage="Item updated."
                >
                  <input type="hidden" name="id" value={item.id} />
                  <Input name="name" defaultValue={item.name} />
                  <Input
                    name="standardPrice"
                    type="number"
                    step="0.01"
                    defaultValue={(item.standardPriceCents / 100).toFixed(2)}
                  />
                  <Input
                    name="memberPrice"
                    type="number"
                    step="0.01"
                    defaultValue={item.memberPriceCents != null ? (item.memberPriceCents / 100).toFixed(2) : ""}
                  />
                  {canCost ? (
                    <Input
                      name="internalCost"
                      type="number"
                      step="0.01"
                      defaultValue={item.internalCostCents != null ? (item.internalCostCents / 100).toFixed(2) : ""}
                    />
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="active" value="true" defaultChecked={item.active} />
                    Active
                  </label>
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && categories.length > 0 ? (
        <div className="space-y-2">
          <h2 className="font-medium">Categories</h2>
          {categories.map((category) => (
            <ActionForm
              key={category.id}
              action={updatePricebookCategoryAction}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-white p-3"
              successMessage="Category updated."
            >
              <input type="hidden" name="id" value={category.id} />
              <Input name="name" defaultValue={category.name} className="max-w-xs" />
              <Input name="sortOrder" type="number" defaultValue={category.sortOrder} className="w-20" />
              <input type="hidden" name="archived" value={category.archived ? "false" : "true"} />
              <Button type="submit" size="sm" variant="outline">
                {category.archived ? "Restore" : "Archive"}
              </Button>
              <Label className="sr-only">Reorder {category.name}</Label>
            </ActionForm>
          ))}
        </div>
      ) : null}
    </div>
  );
}
