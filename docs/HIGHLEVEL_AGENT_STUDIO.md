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

Map these response fields into Agent Studio runtime variables:

- `data.available_slots` → `runtime.available_slots`
- `data.customer` → `runtime.customer`
- `data.requires` → `runtime.requires`
- `error` → `runtime.error`

Each slot includes an opaque `slot_token`. Offer only those windows. Do not invent times.

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

Map:

- `data.booking` → `runtime.booking`
- `data.customer` → `runtime.customer`
- `error` → `runtime.error`

Booking always re-checks ContractorYou capacity. The slot token is not a reservation. If the window is gone, the response is `SLOT_NO_LONGER_AVAILABLE` plus any real alternatives.

## Proof-of-concept flow

1. Customer texts a scheduling need.
2. Regina / the LLM extracts date, daypart, and service need.
3. Call **Check Availability**.
4. Offer only `runtime.available_slots`.
5. Customer picks one.
6. Ask only for missing name, address, or property if `runtime.requires` says so.
7. Call **Book Appointment** with that `slot_token`.
8. Confirm the exact `runtime.booking` window. Do not send a second ContractorYou confirmation text.

## LLM instructions

Availability:

> You are the customer-facing scheduling assistant for this contractor. Only offer appointment windows returned in runtime.available_slots. Never invent availability. Speak naturally and concisely. If additional customer information is required, ask only for the missing information. Do not mention APIs, ContractorYou, capacity calculations, or internal systems.

Confirmation:

> The booking returned in runtime.booking is authoritative. Confirm the exact date and appointment window naturally. Do not claim a technician identity unless the booking response explicitly provides one. Do not invent pricing or diagnostic information.

## Environment

Slot tokens are signed with one of these existing server secrets (names only):

- `SESSION_SECRET`
- `INTEGRATION_SECRET`
- `AGENT_TOOL_SLOT_SECRET` (optional override)

No Agent Tool secret belongs in client-side JavaScript or git.
