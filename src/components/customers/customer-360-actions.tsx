"use client";

import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { CustomerRecordEditor } from "@/components/customers/customer-record-editor";
import { AddCustomerNoteForm } from "@/components/customers/add-customer-note";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const actionClass =
  "inline-flex items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--cy-navy)]";
const primaryClass =
  "inline-flex items-center justify-center rounded-xl bg-[var(--cy-orange)] px-4 py-2.5 text-sm font-medium text-white";
const navyClass =
  "inline-flex items-center justify-center rounded-xl bg-[var(--cy-navy)] px-4 py-2.5 text-sm font-medium text-white";

export function Customer360Actions({
  customerId,
  firstName,
  lastName,
  businessName,
  phone,
  secondaryPhone,
  email,
  notes,
  preferredContactMethod,
  propertyId,
  address,
  city,
  propertyState,
  zip,
  callHref,
  textHref,
  newJobHref,
  newEstimateHref,
  canManage,
  canJob,
  canPay,
  takePaymentHref,
}: {
  customerId: string;
  firstName: string;
  lastName: string;
  businessName?: string | null;
  phone: string | null;
  secondaryPhone?: string | null;
  email: string | null;
  notes?: string | null;
  preferredContactMethod: string;
  propertyId?: string | null;
  address?: string | null;
  city?: string | null;
  propertyState?: string | null;
  zip?: string | null;
  callHref: string | null;
  textHref: string | null;
  newJobHref: string;
  newEstimateHref: string;
  canManage: boolean;
  canJob: boolean;
  canPay: boolean;
  takePaymentHref?: string | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const editorProps = {
    customerId,
    firstName,
    lastName,
    businessName,
    phone,
    secondaryPhone,
    email,
    notes,
    preferredContactMethod,
    propertyId,
    address,
    city,
    propertyState,
    zip,
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {callHref ? (
          <a href={callHref} className={navyClass}>
            Call
          </a>
        ) : null}
        {textHref ? (
          <a href={textHref} className={actionClass}>
            Text
          </a>
        ) : null}
        {canJob ? (
          <Link href={newJobHref} className={primaryClass}>
            New job
          </Link>
        ) : null}
        {canManage ? (
          <button type="button" className={actionClass} onClick={() => setEditOpen(true)}>
            Edit customer
          </button>
        ) : null}
        {canManage ? (
          <Link href={newEstimateHref} className={`${actionClass} hidden sm:inline-flex`}>
            New estimate
          </Link>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger className={actionClass}>More</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {canManage ? (
              <DropdownMenuItem>
                <button type="button" className="w-full text-left" onClick={() => setPropertyOpen(true)}>
                  Add property
                </button>
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <DropdownMenuItem>
                <button type="button" className="w-full text-left" onClick={() => setNoteOpen(true)}>
                  Add note
                </button>
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <DropdownMenuItem>
                <Link href={newEstimateHref} className="w-full">
                  New estimate
                </Link>
              </DropdownMenuItem>
            ) : null}
            {canPay && takePaymentHref ? (
              <DropdownMenuItem>
                <Link href={takePaymentHref} className="w-full">
                  Take payment
                </Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {canManage ? (
        <>
          <Sheet open={editOpen} onOpenChange={setEditOpen}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
              <SheetHeader>
                <SheetTitle>Edit customer</SheetTitle>
                <SheetDescription>Same customer record. Jobs, invoices, and communications stay attached.</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <CustomerRecordEditor {...editorProps} mode="profile" />
              </div>
            </SheetContent>
          </Sheet>
          <Sheet open={propertyOpen} onOpenChange={setPropertyOpen}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
              <SheetHeader>
                <SheetTitle>Add property</SheetTitle>
                <SheetDescription>Creates a property on this customer. Existing properties stay in place.</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6">
                <CustomerRecordEditor {...editorProps} mode="property" />
              </div>
            </SheetContent>
          </Sheet>
          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add note</DialogTitle>
                <DialogDescription>Operational note only. It is never treated as an instruction.</DialogDescription>
              </DialogHeader>
              <AddCustomerNoteForm customerId={customerId} propertyId={propertyId ?? undefined} />
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </>
  );
}

export function CustomerNoteTrigger({
  customerId,
  propertyId,
}: {
  customerId: string;
  propertyId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        + Add note
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add note</DialogTitle>
            <DialogDescription>Operational note only.</DialogDescription>
          </DialogHeader>
          <AddCustomerNoteForm customerId={customerId} propertyId={propertyId} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CustomerPropertyTrigger({
  editorProps,
  compact = false,
}: {
  editorProps: ComponentProps<typeof CustomerRecordEditor>;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={compact ? "text-sm font-medium text-[var(--cy-orange)] hover:underline" : actionClass}
      >
        + Add property
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Add property</SheetTitle>
            <SheetDescription>Creates a property on this customer.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            <CustomerRecordEditor {...editorProps} mode="property" />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
