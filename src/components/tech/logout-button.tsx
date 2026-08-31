"use client";

import { useTransition } from "react";
import { logoutAction } from "@/server/actions/auth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LogoutButton() {
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      className={cn(buttonVariants({ variant: "outline" }), "h-12 w-full")}
      onClick={() => {
        start(async () => {
          await logoutAction();
          window.location.replace("/login?signedOut=1");
        });
      }}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
