"use client";

import { useEffect, useState } from "react";
import { saveQuickBooksItemMappingsAction } from "@/server/actions/quickbooks";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ItemOption = { id: string; name: string; type?: string };

export function QuickBooksItemMappingForm({
  title,
  help,
  items,
  accounts,
  defaultItemId,
  defaultItemName,
  defaultItemStatus,
  defaultItemError,
  serviceTypes,
  serviceMappings,
  expenseAccountId,
  showAccounting,
  invoiceSyncTrigger,
}: {
  title: string;
  help: string;
  items: ItemOption[];
  accounts: ItemOption[];
  defaultItemId: string;
  defaultItemName?: string | null;
  defaultItemStatus?: string | null;
  defaultItemError?: string | null;
  serviceTypes: { id: string; name: string }[];
  serviceMappings: Record<string, string>;
  expenseAccountId?: string;
  showAccounting?: boolean;
  invoiceSyncTrigger?: string;
}) {
  const [selectedDefault, setSelectedDefault] = useState(defaultItemId);
  const [selectedServices, setSelectedServices] = useState(serviceMappings);
  const [selectedAccount, setSelectedAccount] = useState(expenseAccountId ?? "");

  useEffect(() => {
    setSelectedDefault(defaultItemId);
  }, [defaultItemId]);
  useEffect(() => {
    setSelectedServices(serviceMappings);
  }, [serviceMappings]);
  useEffect(() => {
    setSelectedAccount(expenseAccountId ?? "");
  }, [expenseAccountId]);

  const selectedName = items.find((item) => item.id === selectedDefault)?.name || defaultItemName;
  const needsReview = defaultItemStatus === "NEEDS_REVIEW" || defaultItemStatus === "FAILED";
  const dropdownItems =
    selectedDefault && !items.some((item) => item.id === selectedDefault)
      ? [{ id: selectedDefault, name: `${selectedName || "Saved item"} (needs review)` }, ...items]
      : items;

  return (
    <ActionForm action={saveQuickBooksItemMappingsAction} className="space-y-4 rounded-2xl border border-[var(--border)] bg-white p-6">
      <h2 className="font-medium">{title}</h2>
      <p className="text-sm text-[var(--muted-foreground)]">{help}</p>
      {selectedDefault && !needsReview ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Saved default: {selectedName || "QuickBooks item"} · ID {selectedDefault}
        </p>
      ) : null}
      {selectedDefault && needsReview ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Saved mapping needs review
          {defaultItemError ? `: ${defaultItemError}` : "."} Item ID {selectedDefault} is not being substituted.
        </p>
      ) : null}
      {!selectedDefault ? (
        <p className="text-sm text-amber-800">No default Product/Service is saved yet. Invoice sync will wait until you save one.</p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          We could not load QuickBooks items yet. You can still paste a Product/Service ID.
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="defaultItemId">Default QuickBooks Product/Service</Label>
        <input type="hidden" name="defaultItemId" value={selectedDefault} />
        {dropdownItems.length ? (
          <select
            id="defaultItemId"
            value={selectedDefault}
            onChange={(event) => setSelectedDefault(event.target.value)}
            required
            className="h-10 w-full rounded-lg border border-input px-3 text-sm"
          >
            <option value="">Choose one</option>
            {dropdownItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="defaultItemSelect"
            value={selectedDefault}
            onChange={(event) => setSelectedDefault(event.target.value)}
            placeholder="QuickBooks item ID"
          />
        )}
      </div>
      {serviceTypes.map((service) => (
        <div key={service.id} className="space-y-2">
          <Label htmlFor={`serviceItem:${service.id}`}>{service.name}</Label>
          <input type="hidden" name={`serviceItem:${service.id}`} value={selectedServices[service.id] || ""} />
          {items.length ? (
            <select
              id={`serviceItem:${service.id}`}
              value={selectedServices[service.id] || ""}
              onChange={(event) =>
                setSelectedServices((current) => ({ ...current, [service.id]: event.target.value }))
              }
              className="h-10 w-full rounded-lg border border-input px-3 text-sm"
            >
              <option value="">Use default</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={selectedServices[service.id] || ""}
              onChange={(event) =>
                setSelectedServices((current) => ({ ...current, [service.id]: event.target.value }))
              }
              placeholder="QuickBooks item ID"
            />
          )}
        </div>
      ))}
      {showAccounting ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="expenseAccountId">Default expense account</Label>
            <input type="hidden" name="expenseAccountId" value={selectedAccount} />
            {accounts.length ? (
              <select
                id="expenseAccountId"
                value={selectedAccount}
                onChange={(event) => setSelectedAccount(event.target.value)}
                className="h-10 w-full rounded-lg border border-input px-3 text-sm"
              >
                <option value="">Choose one</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={selectedAccount}
                onChange={(event) => setSelectedAccount(event.target.value)}
                placeholder="QuickBooks expense account ID"
              />
            )}
          </div>
          <input type="hidden" name="invoiceSyncTrigger" value={invoiceSyncTrigger || "MANUAL_ONLY"} />
        </>
      ) : null}
      <Button type="submit">Save mappings</Button>
    </ActionForm>
  );
}
