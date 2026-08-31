"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Reveal({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!open) {
    return (
      <button type="button" className={cn(buttonVariants(), "mt-3 h-12 w-full")} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return <div className="mt-3">{children}</div>;
}
