"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteJobAction } from "@/server/actions/jobs";

export function DeleteJobButton({
  jobId,
  jobNumber,
}: {
  jobId: string;
  jobNumber: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="h-10 text-rose-700" />}>
        Delete job
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {jobNumber}?</DialogTitle>
          <DialogDescription>
            This removes the job from the list. Invoices and payments stay on the customer. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep job
          </Button>
          <ActionForm action={deleteJobAction}>
            <input type="hidden" name="jobId" value={jobId} />
            <Button type="submit" className="bg-rose-700 text-white hover:bg-rose-800">
              Delete job
            </Button>
          </ActionForm>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
