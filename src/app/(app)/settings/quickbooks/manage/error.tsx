"use client";

import { Button } from "@/components/ui/button";

export default function QuickBooksManageError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-rose-50 p-6">
      <h1 className="font-semibold text-rose-950">Unable to load customer exception.</h1>
      <p className="mt-1 text-sm text-rose-800">Your review decisions and customer records were not changed.</p>
      <Button type="button" variant="outline" className="mt-4" onClick={reset}>
        Retry
      </Button>
    </div>
  );
}
