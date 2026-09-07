"use client";

import { useEffect, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewWaitingUpdateAction, sendWaitingUpdateNowAction } from "@/server/actions/waiting";

export function SendUpdateDialog({
  open,
  onOpenChange,
  recordId,
  customerName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recordId: string;
  customerName: string;
}) {
  const [body, setBody] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWarning(null);
    const form = new FormData();
    form.set("recordId", recordId);
    void previewWaitingUpdateAction(null, form).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok && result.preview) {
        setBody(result.preview);
        setWarning(result.message ?? null);
        return;
      }
      setBody("");
      setError(result.ok ? "No message preview is available." : result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, recordId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send update now</DialogTitle>
          <DialogDescription>
            This uses the existing HighLevel communication path. Preview the real message, edit it if needed, then send.
            <br />
            {customerName}
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-[var(--muted-foreground)]">Loading the actual message preview…</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        {warning ? <p className="text-sm text-amber-800">{warning}</p> : null}
        <ActionForm
          action={sendWaitingUpdateNowAction}
          onSuccess={() => onOpenChange(false)}
          className="space-y-3"
        >
          <input type="hidden" name="recordId" value={recordId} />
          <Textarea
            name="body"
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Message preview will appear here."
          />
          <Button type="submit" disabled={!body.trim() || loading} className="h-11 w-full">
            Send update now
          </Button>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
