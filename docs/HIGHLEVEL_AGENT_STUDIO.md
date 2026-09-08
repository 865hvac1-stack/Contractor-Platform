# HighLevel Agent Studio tools

Regina / HighLevel Conversation AI talks to the customer. ContractorYou remains the source of truth for customers, properties, availability, capacity, jobs, and Dispatch.

Phase 1 tools:

- `POST /api/agent-tools/check-availability`
- `POST /api/agent-tools/book-appointment`

These are authenticated machine-to-machine tools. They are not public customer APIs. They never send SMS.

## Authentication

1. In ContractorYou go to **Settings → HighLevel → HighLevel Agent Studio tools**.
2. Click **Generate Agent Tool key**.
3. Copy the key immediately. It is hashed at rest and will not be shown again.
4. In Agent Studio, send:

```
Authorization: Bearer <ContractorYou Agent Tool key>
Content-Type: application/json
```

The key belongs to one ContractorYou company. It cannot be used for another tenant.

These routes are exempt from the ContractorYou session cookie so Agent Studio can call them. They are still rejected without a valid Agent Tool bearer key.

Optional booking header:

```
Idempotency-Key: <unique value per booking attempt>
```

## Tenant and location

The bearer key resolves the company. If `location_id` is sent, it must match that company's connected HighLevel location. A mismatch returns HTTP 403 `LOCATION_MISMATCH`.

## Check availability

`POST https://<your-contractoryou-host>/api/agent-tools/check-availability`

Request fields are all optional except that enough context should exist for a useful search:

```json
{
  "location_id": "HighLevel location id",
  "contact_id": "HighLevel contact id",
  "conversation_id": "HighLevel conversation id",
  "customer_phone": "+18655550100",
  "service_type": "Residential Service Call",
  "service_need": "Upstairs AC is not cooling",
  "requested_date": "2026-09-09",
  "requested_daypart": "afternoon"
}
```

HighLevel Agent Studio often drops nested objects and arrays (`data` can appear as `{}` in a live run even when the Custom API Test tab shows the full JSON). The API still returns the rich nested `data` contract. It also returns **top-level scalars** for Response Mapping.

Map these **top-level** fields first:

- `availability_found` → `runtime.availability_found`
- `available_slots_text` → `runtime.available_slots_text`
- `slot_1_display` / `slot_1_token` → `runtime.slot_1_display` / `runtime.slot_1_token`
- `slot_2_display` / `slot_2_token`
- `slot_3_display` / `slot_3_token`
- `slot_4_display` / `slot_4_token`
- `customer_first_name` → `runtime.customer_first_name`
- `customer_status` → `runtime.customer_status`
- `property_address` → `runtime.property_address`
- `property_status` → `runtime.property_status`
- `service_type_name` → `runtime.service_type_name`
- `requires_customer_name` → `runtime.requires_customer_name`
- `requires_service_address` → `runtime.requires_service_address`
- `requires_property_selection` → `runtime.requires_property_selection`
- `requires_office` → `runtime.requires_office`
- `agent_instruction` → `runtime.agent_instruction`
- `error_code` → `runtime.error_code`

Keep `data.available_slots` in the JSON for debugging. Do not rely on it inside a live Agent run.

Unused slot numbers are `null`. `available_slots_text` is the same windows joined with ` | `. Never invent times.

## Book appointment

`POST https://<your-contractoryou-host>/api/agent-tools/book-appointment`

```json
{
  "location_id": "...",
  "contact_id": "...",
  "conversation_id": "...",
  "slot_token": "<token from available_slots>",
  "customer_phone": "+18655550100",
  "customer_name": "JR Day",
  "service_type": "Residential Service Call",
  "service_need": "Upstairs AC is not cooling",
  "property_id": "optional-if-already-known",
  "service_address": {
    "line1": "123 Main Street",
    "city": "Knoxville",
    "state": "TN",
    "postal_code": "37918"
  }
}
```

Map these **top-level** fields first:

- `booking_confirmed` → `runtime.booking_confirmed`
- `appointment_display` → `runtime.appointment_display`
- `appointment_date` → `runtime.appointment_date`
- `appointment_window_start` / `appointment_window_end`
- `booking_id` / `job_id` / `job_number`
- `customer_first_name` / `property_address`
- `agent_instruction` → `runtime.agent_instruction`
- `error_code` → `runtime.error_code`
- On `SLOT_NO_LONGER_AVAILABLE`: `slot_1_display` … `slot_4_token` and `available_slots_text`

`technician_name` is only filled when ContractorYou already has a name. Do not invent one.

Booking always re-checks ContractorYou capacity. The slot token is not a reservation. If the window is gone, the response is `SLOT_NO_LONGER_AVAILABLE` plus any real alternatives, flattened the same way as check-availability.

## Proof-of-concept flow

1. Customer texts a scheduling need.
2. Regina / the LLM extracts date, daypart, and service need.
3. Call **Check Availability**.
4. Offer only `runtime.slot_1_display` through `runtime.slot_4_display` (or `runtime.available_slots_text`). Skip null slots.
5. Customer picks one. Use the matching `runtime.slot_N_token`.
6. Ask only for missing name, address, or property when the `requires_*` booleans are true.
7. Call **Book Appointment** with that `slot_token`.
8. Confirm the exact `runtime.appointment_display`. Do not send a second ContractorYou confirmation text.

## LLM instructions

Availability:

> You are the customer-facing scheduling assistant for this contractor. Follow runtime.agent_instruction. Only offer appointment windows in runtime.slot_1_display through runtime.slot_4_display or runtime.available_slots_text. Never invent availability. Speak naturally and concisely. If additional customer information is required, ask only for the missing information. Do not mention APIs, ContractorYou, capacity calculations, or internal systems.

Confirmation:

> runtime.appointment_display is authoritative when runtime.booking_confirmed is true. Confirm that exact date and appointment window naturally. Do not claim a technician identity unless technician_name is present. Do not invent pricing or diagnostic information.

## Environment

Slot tokens are signed with one of these existing server secrets (names only):

- `SESSION_SECRET`
- `INTEGRATION_SECRET`
- `AGENT_TOOL_SLOT_SECRET` (optional override)

No Agent Tool secret belongs in client-side JavaScript or git.
