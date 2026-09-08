# HighLevel Agent Studio — hybrid scheduling contract

HighLevel Regina is the conversational layer. ContractorYou is the only source of truth for availability, identity, booking, jobs, and Dispatch. HighLevel SMS is transport.

HIGHLEVEL_AI remains the conversation owner for 865 HVAC. That is correct. Regina may greet the customer and collect the problem. She must never be the authority that declares a booking successful.

## Hard rule

**HighLevel Regina must never tell a customer they are booked, scheduled, or confirmed unless ContractorYou returned `booking_confirmed: true` after a Job and SchedulingBooking actually persisted.**

`success=true` does **not** mean the appointment is booked.

`booking_confirmed=true` is allowed only after ContractorYou has:

1. resolved the canonical company
2. resolved the canonical HighLevel conversation
3. resolved the canonical customer
4. resolved the canonical property
5. resolved the exact stored selected slot
6. rechecked capacity
7. created exactly one Job
8. created exactly one SchedulingBooking
9. updated Dispatch (the scheduled job + technician assignment)
10. committed the transaction
11. verified the persisted records
12. sent the customer confirmation through `sendCompanyCommunication` when `send_to_customer=true`

If any required step fails, ContractorYou returns `booking_confirmed: false` and either asks for the missing information, offers fresh availability, or hands off to the office.

## Workflows

Keep these three HighLevel workflows. Do not add a HighLevel calendar booking step.

1. **ContractorYou — Check Availability**
2. **ContractorYou — Select Offered Slot**
3. **ContractorYou — Book Selected Slot**

HighLevel does not send `conversation_id`. ContractorYou resolves the canonical thread from:

- company
- provider = HighLevel
- inbound SMS phone
- HighLevel `contact_id`
- existing HighLevel thread mapping

If more than one **active** conversation makes that unsafe, ContractorYou returns `requires_office=true` and does not guess.

## Authentication

1. In ContractorYou go to **Settings → HighLevel → HighLevel Agent Studio tools**.
2. Click **Generate Agent Tool key**.
3. In Agent Studio send:

```
Authorization: Bearer <ContractorYou Agent Tool key>
Content-Type: application/json
```

Optional booking header:

```
Idempotency-Key: <unique value per booking attempt>
```

Pass these fields on every action when HighLevel has them:

```json
{
  "customer_phone": "+18653858079",
  "contact_id": "HighLevel contact id",
  "service_type": "Residential Service Call",
  "service_need": "It's currently not cooling",
  "service_address": "8233 Tazewell Pike",
  "send_to_customer": true
}
```

Phone formats `+18653858079`, `8653858079`, and `(865) 385-8079` resolve to the same canonical US number.

## Check Availability

`POST /api/agent-tools/check-availability`

ContractorYou returns real capacity windows and persists them on the canonical conversation as `offeredSlots`.

Map these top-level fields:

- `availability_found`
- `available_slots_text`
- `slot_1_display` / `slot_1_token` through `slot_4_*`
- `requires_customer_name`
- `requires_service_address`
- `requires_property_selection`
- `requires_office`
- `booking_confirmed` — always `false` here
- `agent_instruction`
- `error_code`

Regina may offer only those windows. She may keep conversational tone. She must not invent times.

## Select Offered Slot

`POST /api/agent-tools/select-offered-slot`

```json
{
  "customer_phone": "+18653858079",
  "contact_id": "...",
  "customer_reply": "Tuesday September 15th",
  "service_need": "It's currently not cooling",
  "service_address": "8233 Tazewell Pike",
  "send_to_customer": true
}
```

For `Tuesday September 15th` ContractorYou must:

1. resolve the canonical conversation
2. load persisted `offeredSlots`
3. match September 15
4. persist that exact selected slot
5. decide whether booking prerequisites are complete

If the customer is new and the name is missing:

```
match_status: exact
slot_selected: true
ready_to_book: false
booking_confirmed: false
requires_customer_name: true
customer_message: "Absolutely. Before I finish scheduling that, what's your name?"
agent_instruction: "Do not tell the customer they are booked. ContractorYou will send the booking confirmation after the booking transaction succeeds."
```

The selected slot is preserved. Do **not** make the customer pick the appointment again.

**After Select Offered Slot, Regina must NOT say “I’ve got you scheduled.” She should trigger Book Selected Slot, or ask only for the missing field ContractorYou returned.**

If `send_to_customer=true`, ContractorYou already sent the name/address question. Regina should not send a second operational SMS.

## Book Selected Slot

`POST /api/agent-tools/book-selected-slot`  
Alias: `POST /api/agent-tools/book-appointment`

```json
{
  "customer_phone": "+18653858079",
  "contact_id": "...",
  "customer_name": "TJ Hurst",
  "customer_reply": "TJ Hurst",
  "service_address": "8233 Tazewell Pike",
  "service_need": "It's currently not cooling",
  "send_to_customer": true
}
```

`slot_token` is optional when Select already persisted the selected slot.

Top-level fields HighLevel must map:

- `success`
- `booking_confirmed`
- `booking_id`
- `job_id`
- `job_number`
- `appointment_display`
- `customer_id`
- `customer_first_name`
- `property_id`
- `property_address`
- `requires_customer_name`
- `requires_service_address`
- `requires_property_selection`
- `requires_office`
- `customer_message`
- `error_code`
- `agent_instruction`

If `booking_confirmed=true` and `send_to_customer=true`:

```
agent_instruction: "Booking is confirmed in ContractorYou. Do not send a duplicate confirmation because ContractorYou already sent it."
```

ContractorYou sends one SMS, for example:

`Perfect — you're scheduled for Tuesday, September 15 from 9–11 AM at 8233 Tazewell Pike.`

If Book is called twice, HighLevel retries, or Select and Book both fire after the name is collected, ContractorYou reuses the same Job / SchedulingBooking and does not send a second confirmation.

## Identity and property

The inbound SMS phone is authoritative transport context.

- Existing ContractorYou customer with a reliable name: reuse them. Do not ask for their name again.
- No ContractorYou customer: collect name before booking. Address alone is not enough.
- New customer minimum: phone + name + service address + service concern/type.
- Existing customer + one property: reuse it.
- Existing customer + multiple properties: ask which property. Keep the selected slot.
- Existing customer + no property: ask for the service address, then create/link one property.
- Do not create duplicate customers or properties.

## State machine

```
NEED_CUSTOMER
→ NEED_PROPERTY
→ NEED_SERVICE_CONTEXT
→ CHECK_AVAILABILITY
→ SLOTS_OFFERED
→ SLOT_SELECTED
→ READY_TO_BOOK
→ BOOKING
→ BOOKED
```

This path is illegal and was the production failure:

```
SLOTS_OFFERED → customer says a date → HighLevel verbally says BOOKED
```

without ContractorYou reaching `BOOKED`.

## Regina prompt rules

Allowed conversational lines:

- “Absolutely.”
- “I can help with that.”
- “What’s going on with the system?”

Forbidden unless `booking_confirmed=true`:

- “You’re booked.”
- “You’re scheduled.”
- “Your appointment is confirmed.”
- “I’ve got you scheduled.”

After Select Offered Slot:

> Do not tell the customer they are booked. If `ready_to_book` is true, trigger Book Selected Slot. If `requires_customer_name` is true, ask only for their name. ContractorYou will send the booking confirmation after the booking transaction succeeds.

After Book Selected Slot:

> If `booking_confirmed` is false, follow `customer_message` / `agent_instruction`. If `booking_confirmed` is true, do not send another confirmation. ContractorYou already sent it.

## Environment

Slot tokens are signed with one of these existing server secrets (names only):

- `SESSION_SECRET`
- `INTEGRATION_SECRET`
- `AGENT_TOOL_SLOT_SECRET` (optional override)

No Agent Tool secret belongs in client-side JavaScript or git.
