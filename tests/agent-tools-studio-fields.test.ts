import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toolError, toolOk } from "@/lib/agent-tools/envelope";
import {
  availabilityStudioFields,
  bookingStudioFields,
  flattenSlots,
} from "@/lib/agent-tools/studio-fields";

const slot = (n: number) => ({
  slot_token: `tok_${n}`,
  date: `2026-09-1${n}`,
  window_start: "09:00",
  window_end: "11:00",
  display: `Monday, September 1${n} from 9–11 AM`,
});

describe("Agent Studio flat availability fields", () => {
  it("copies 1 slot and leaves the rest null", () => {
    const slots = [slot(4)];
    const flat = flattenSlots(slots);
    expect(flat.availability_found).toBe(true);
    expect(flat.slot_1_display).toBe(slots[0]!.display);
    expect(flat.slot_1_token).toBe(slots[0]!.slot_token);
    expect(flat.slot_2_display).toBeNull();
    expect(flat.slot_2_token).toBeNull();
    expect(flat.slot_3_display).toBeNull();
    expect(flat.slot_4_token).toBeNull();
    expect(flat.available_slots_text).toBe(slots[0]!.display);
  });

  it("copies 2 slots exactly", () => {
    const slots = [slot(4), slot(5)];
    const flat = flattenSlots(slots);
    expect(flat.slot_1_display).toBe(slots[0]!.display);
    expect(flat.slot_2_display).toBe(slots[1]!.display);
    expect(flat.slot_3_display).toBeNull();
    expect(flat.slot_4_display).toBeNull();
    expect(flat.available_slots_text).toBe(`${slots[0]!.display} | ${slots[1]!.display}`);
  });

  it("copies 4 slots and does not invent a fifth", () => {
    const slots = [slot(4), slot(5), slot(6), slot(7), slot(8)];
    const flat = flattenSlots(slots);
    expect(flat.slot_1_token).toBe("tok_4");
    expect(flat.slot_4_token).toBe("tok_7");
    expect(flat.available_slots_text).not.toContain("tok_8");
    expect(flat.available_slots_text.split(" | ")).toHaveLength(4);
  });

  it("returns null slots and empty text when none exist", () => {
    const flat = flattenSlots([]);
    expect(flat.availability_found).toBe(false);
    expect(flat.slot_1_display).toBeNull();
    expect(flat.slot_1_token).toBeNull();
    expect(flat.slot_4_display).toBeNull();
    expect(flat.available_slots_text).toBe("");
  });

  it("flattens an existing customer with a resolved property to match nested data", () => {
    const data = {
      customer: {
        status: "existing",
        customer_id: "cus_tj",
        first_name: "TJ",
        property_status: "resolved",
        property_id: "prop_1",
        properties: [{ id: "prop_1", display_address: "8233 Tazewell Pike, Corryton, TN 37721" }],
      },
      service_type: { id: "svc_1", name: "Residential Service Call" },
      available_slots: [slot(4), slot(5)],
      requires: [],
      requires_office: false,
    };
    const body = toolOk("check_availability", data);
    const flat = availabilityStudioFields(data);
    expect(body.data).toEqual(data);
    expect(body.availability_found).toBe(true);
    expect(body.customer_status).toBe("existing");
    expect(body.customer_first_name).toBe("TJ");
    expect(body.customer_id).toBe("cus_tj");
    expect(body.property_status).toBe("resolved");
    expect(body.property_id).toBe("prop_1");
    expect(body.property_address).toBe("8233 Tazewell Pike, Corryton, TN 37721");
    expect(body.service_type_name).toBe("Residential Service Call");
    expect(body.slot_1_display).toBe(data.available_slots[0]!.display);
    expect(body.slot_1_token).toBe(data.available_slots[0]!.slot_token);
    expect(body.slot_2_display).toBe(data.available_slots[1]!.display);
    expect(body.available_slots_text).toBe(flat.available_slots_text);
    expect(body.requires_customer_name).toBe(false);
    expect(body.requires_service_address).toBe(false);
    expect(body.requires_property_selection).toBe(false);
    expect(body.requires_office).toBe(false);
    expect(body.agent_instruction).toContain("Do not invent additional availability");
    expect(body.data?.available_slots).toHaveLength(2);
  });

  it("flags a new customer without inventing slots", () => {
    const data = {
      customer: { status: "new", customer_id: null, first_name: null, property_status: "missing", property_id: null, properties: [] },
      service_type: { id: "svc_1", name: "Residential Service Call" },
      available_slots: [slot(4)],
      requires: ["customer_name", "service_address"],
      requires_office: false,
    };
    const body = toolOk("check_availability", data);
    expect(body.customer_status).toBe("new");
    expect(body.requires_customer_name).toBe(true);
    expect(body.requires_service_address).toBe(true);
    expect(body.requires_property_selection).toBe(false);
    expect(body.slot_1_display).toBe(data.available_slots[0]!.display);
    expect(body.slot_2_display).toBeNull();
    expect(body.agent_instruction).toContain("Customer is new");
  });

  it("flags a missing property on an existing customer", () => {
    const data = {
      customer: {
        status: "existing",
        customer_id: "cus_1",
        first_name: "JR",
        property_status: "missing",
        property_id: null,
        properties: [],
      },
      service_type: { name: "Residential Service Call" },
      available_slots: [slot(4)],
      requires: ["service_address"],
      requires_office: false,
    };
    const body = toolOk("check_availability", data);
    expect(body.requires_service_address).toBe(true);
    expect(body.requires_property_selection).toBe(false);
    expect(body.agent_instruction).toBe(
      "Customer was found, but service address is required before booking. Ask only for the service address. Do not tell the customer they are booked."
    );
  });

  it("flags multiple properties without guessing an address", () => {
    const data = {
      customer: {
        status: "existing",
        customer_id: "cus_1",
        first_name: "JR",
        property_status: "multiple",
        property_id: null,
        properties: [
          { id: "p1", display_address: "1 Main St" },
          { id: "p2", display_address: "2 Oak St" },
        ],
      },
      service_type: { name: "Residential Service Call" },
      available_slots: [slot(4), slot(5)],
      requires: ["property_id"],
      requires_office: false,
    };
    const body = toolOk("check_availability", data);
    expect(body.requires_property_selection).toBe(true);
    expect(body.property_id).toBeNull();
    expect(body.property_address).toBeNull();
    expect(body.agent_instruction).toBe(
      "Customer has multiple properties. Ask which service address this visit is for. Do not tell the customer they are booked."
    );
    expect(body.data?.available_slots).toEqual(data.available_slots);
  });

  it("sets requires_office and null slots when availability is empty", () => {
    const data = {
      customer: { status: "existing", customer_id: "cus_1", first_name: "TJ", property_status: "resolved", property_id: "p1", properties: [] },
      service_type: { name: "Residential Service Call" },
      available_slots: [],
      requires: [],
      requires_office: true,
    };
    const body = toolOk("check_availability", data);
    expect(body.availability_found).toBe(false);
    expect(body.slot_1_display).toBeNull();
    expect(body.slot_1_token).toBeNull();
    expect(body.available_slots_text).toBe("");
    expect(body.requires_office).toBe(true);
    expect(body.agent_instruction).toBe("No valid ContractorYou appointment windows were found. Do not promise a time.");
    expect(body.data?.available_slots).toEqual([]);
  });
});

describe("Agent Studio flat booking fields", () => {
  it("flattens a successful booking and keeps nested data", () => {
    const data = {
      booking_confirmed: true,
      booking_id: "bk_1",
      job_id: "job_1",
      booking: {
        booking_id: "bk_1",
        job_id: "job_1",
        job_number: "865-1001",
        status: "confirmed",
        date: "2026-09-14",
        window_start: "09:00",
        window_end: "11:00",
        display: "Monday, September 14 from 9–11 AM",
        technician_id: "tech_1",
      },
      customer: { customer_id: "cus_tj", first_name: "TJ" },
      property: { property_id: "prop_1", display_address: "8233 Tazewell Pike, Corryton, TN 37721" },
    };
    const body = toolOk("book_appointment", data);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(data);
    expect(body.booking_confirmed).toBe(true);
    expect(body.booking_id).toBe("bk_1");
    expect(body.job_id).toBe("job_1");
    expect(body.job_number).toBe("865-1001");
    expect(body.appointment_display).toBe("Monday, September 14 from 9–11 AM");
    expect(body.appointment_date).toBe("2026-09-14");
    expect(body.appointment_window_start).toBe("09:00");
    expect(body.appointment_window_end).toBe("11:00");
    expect(body.customer_first_name).toBe("TJ");
    expect(body.property_address).toBe("8233 Tazewell Pike, Corryton, TN 37721");
    expect(body.technician_name).toBeNull();
    expect(body.error_code).toBeNull();
    expect(body.agent_instruction).toBe(
      "Booking is confirmed in ContractorYou. Do not send a duplicate confirmation because ContractorYou already sent it."
    );
  });

  it("flattens a booking validation failure", () => {
    const body = toolError(
      "book_appointment",
      "SERVICE_ADDRESS_REQUIRED",
      "A service address is required before booking.",
      { required_fields: ["service_address.line1"] }
    );
    expect(body.success).toBe(false);
    expect(body.booking_confirmed).toBe(false);
    expect(body.error_code).toBe("SERVICE_ADDRESS_REQUIRED");
    expect(body.requires_service_address).toBe(true);
    expect(body.appointment_display).toBeNull();
    expect(body.data?.required_fields).toEqual(["service_address.line1"]);
  });

  it("flattens SLOT_NO_LONGER_AVAILABLE alternatives from nested data only", () => {
    const alternatives = [slot(5), slot(6)];
    const body = toolError(
      "book_appointment",
      "SLOT_NO_LONGER_AVAILABLE",
      "That window is no longer available.",
      { available_slots: alternatives }
    );
    expect(body.booking_confirmed).toBe(false);
    expect(body.error_code).toBe("SLOT_NO_LONGER_AVAILABLE");
    expect(body.availability_found).toBe(true);
    expect(body.slot_1_display).toBe(alternatives[0]!.display);
    expect(body.slot_1_token).toBe(alternatives[0]!.slot_token);
    expect(body.slot_2_display).toBe(alternatives[1]!.display);
    expect(body.slot_3_display).toBeNull();
    expect(body.available_slots_text).toBe(`${alternatives[0]!.display} | ${alternatives[1]!.display}`);
    expect(body.data?.available_slots).toEqual(alternatives);
    expect(body.agent_instruction).toContain("just taken");
    expect(bookingStudioFields({ available_slots: alternatives }, "SLOT_NO_LONGER_AVAILABLE").slot_1_token).toBe("tok_5");
  });

  it("never sends SMS from the flatten adapter", () => {
    const flatten = readFileSync(resolve("src/lib/agent-tools/studio-fields.ts"), "utf8");
    const envelope = readFileSync(resolve("src/lib/agent-tools/envelope.ts"), "utf8");
    expect(flatten).not.toMatch(/sendCompanyCommunication/);
    expect(envelope).toMatch(/withStudioFields/);
    expect(readFileSync(resolve("src/lib/agent-tools/book-appointment.ts"), "utf8")).toMatch(/sendConfirmation: false/);
  });
});
