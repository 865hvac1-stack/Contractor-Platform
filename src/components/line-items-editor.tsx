"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LineItemRow = {
  key: string;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

function newRow(): LineItemRow {
  return {
    key: crypto.randomUUID(),
    name: "",
    description: "",
    quantity: "1",
    unitPrice: "",
  };
}

export function LineItemsEditor({ showCost = false }: { showCost?: boolean }) {
  const [rows, setRows] = useState<LineItemRow[]>([newRow()]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-base">Line items</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((r) => [...r, newRow()])}
        >
          Add row
        </Button>
      </div>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="grid gap-3 rounded-lg border border-[var(--border)] bg-white p-3 sm:grid-cols-12"
          >
            <div className="sm:col-span-3">
              <Label htmlFor={`itemName-${row.key}`}>Name</Label>
              <Input
                id={`itemName-${row.key}`}
                name="itemName"
                required
                defaultValue={row.name}
                placeholder="Labor / Materials"
              />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor={`itemDescription-${row.key}`}>Description</Label>
              <Input
                id={`itemDescription-${row.key}`}
                name="itemDescription"
                defaultValue={row.description}
                placeholder="Optional"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={`itemQuantity-${row.key}`}>Qty</Label>
              <Input
                id={`itemQuantity-${row.key}`}
                name="itemQuantity"
                type="number"
                min="0.001"
                step="any"
                required
                defaultValue={row.quantity}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor={`itemUnitPrice-${row.key}`}>Unit price ($)</Label>
              <Input
                id={`itemUnitPrice-${row.key}`}
                name="itemUnitPrice"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={row.unitPrice}
                placeholder="0.00"
              />
            </div>
            {showCost ? (
              <div className="sm:col-span-2">
                <Label htmlFor={`itemCost-${row.key}`}>Cost ($)</Label>
                <Input
                  id={`itemCost-${row.key}`}
                  name="itemCost"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Optional"
                />
              </div>
            ) : (
              <div className="flex items-end sm:col-span-2">
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            )}
            <input type="hidden" name="itemTaxable" value="true" />
            <input type="hidden" name="itemCategory" value="" />
            {showCost && rows.length > 1 ? (
              <div className="sm:col-span-12">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRows((r) => r.filter((_, i) => i !== index))}
                >
                  Remove row
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
