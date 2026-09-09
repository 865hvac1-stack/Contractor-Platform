# HighLevel Agent Studio — ContractorYou-owned scheduling

HighLevel Regina is the conversational front-end. ContractorYou is the complete deterministic scheduling state machine. HighLevel SMS is transport.

HIGHLEVEL_AI remains the conversation owner for 865 HVAC. That is correct for greetings and non-scheduling talk. Regina must never be the authority that declares a booking successful.

## Root architecture

Conversation AI Trigger Workflow is asynchronous / fire-and-forget. Regina cannot read workflow HTTP responses, cannot branch on ContractorYou JSON, and cannot reliably sequence Check → Select → Book.

```
Customer SMS
→ HighLevel Regina detects scheduling intent
→ ONE HighLevel workflow: start-scheduling
→ ContractorYou starts/owns the scheduling session
→ ContractorYou asks questions and offers real windows through the same HighLevel SMS thread
→ Customer replies
→ inbound HighLevel webhook routes the reply to the ContractorYou session
→ ContractorYou determines the next step and sends exactly one operational SMS
→ repeat until booked
→ ContractorYou creates Job + SchedulingBooking + Dispatch
→ ContractorYou sends the only confirmation
→ session closes (BOOKED / HANDOFF / CANCELLED)
→ Regina may resume normal non-scheduling conversation
```

Once ContractorYou owns an active scheduling session, Regina must not independently orchestrate scheduling.

## One entry action

`POST /api/agent-tools/start-scheduling`

This is the only HighLevel Conversation AI workflow action required to start scheduling.

```json
{
  "phone": "+18653858079",
  "contact_id": "HighLevel contact id",
  "service_type": "Residential Service Call",
  "service_need": "It's not cooling",
  "service_address": "8233 Tazewell Pike",
  "send_to_customer": true
}
```

HighLevel does not send `conversation_id`. ContractorYou resolves the canonical thread from:

- company
- provider = HighLevel
- normalized inbound phone
- HighLevel `contact_id`
- existing HighLevel thread mapping

If more than one active conversation makes that unsafe, ContractorYou returns `requires_office=true` and does not guess.

A second start-scheduling trigger on the same conversation reuses the open session. It does not start a second flow and does not send a duplicate offer.

## Compatibility endpoints

Keep these for testing and backward compatibility. They are no longer the primary Conversation AI orchestration architecture.

- `POST /api/agent-tools/check-availability`
- `POST /api/agent-tools/select-offered-slot`
- `POST /api/agent-tools/book-selected-slot`
- alias: `POST /api/agent-tools/book-appointment`

## Hard rule

**HighLevel Regina must never tell a customer they are booked, scheduled, or confirmed unless ContractorYou has already sent the confirmation after a Job and SchedulingBooking persisted.**

Forbidden unless ContractorYou confirmed:

- “You’re booked.”
- “You’re scheduled.”
- “Your appointment is confirmed.”
- “I’ve got you scheduled.”

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
9. updated Dispatch
10. committed the transaction
11. verified the persisted records
12. sent the customer confirmation through `sendCompanyCommunication`

## Session states

Stored on the existing `ConversationSchedulingState` (`lastAiAction`):

```
STARTED
NEED_CUSTOMER_NAME
NEED_PROPERTY
NEED_SERVICE_CONTEXT
CHECKING_AVAILABILITY
SLOTS_OFFERED
WAITING_FOR_SLOT_SELECTION
SLOT_SELECTED
READY_TO_BOOK
BOOKING
BOOKED
HANDOFF
CANCELLED
```

The session survives across separate inbound SMS messages.

## Inbound routing

When a HighLevel inbound SMS arrives, before receptionist / conversational Regina behavior:

1. Resolve the canonical conversation
2. Check for an active ContractorYou scheduling session
3. If active, route the inbound message to the scheduling state machine
4. Do not let ContractorYou Regina generate a competing response
5. Do not start another scheduling flow
6. Process the reply according to the current session state
7. Send exactly one operational SMS through canonical HighLevel communications

Provider message IDs are idempotent. A duplicate HighLevel webhook does not send a second SMS.

## Identity and property

Phone formats `+18653858079`, `8653858079`, and `(865) 385-8079` resolve to the same canonical US number. HighLevel `contact_id` is additional strong identity evidence. Customers are never merged solely on weak address similarity.

- Existing customer with a reliable name: reuse them.
- Existing customer + one property: reuse it.
- Existing customer + multiple properties: ask “Which property do you need service at?”
- Existing customer + no property: ask for the service address.
- New customer: collect only missing fields. Normally name, then address.
- Name is required before booking, not before offering real availability.
- If start-scheduling already has the concern and address, do not ask again.

## Availability and booking

ContractorYou uses the existing capacity engine. It does not invent windows.

After a natural selection such as `Tuesday September 15th`, the exact offered slot is persisted. If the name is still missing, ContractorYou asks:

`Absolutely. Before I finish scheduling that, what's your name?`

The selected slot is preserved. The next inbound SMS stays on the same session. After `TJ Hurst`, ContractorYou creates/matches Customer + Property, rechecks capacity, and books automatically. No second HighLevel workflow is required.

If the final capacity check fails, ContractorYou does not book or confirm. It retrieves fresh real availability and texts:

`That appointment was just taken, but I have these openings available...`

One session. One Job. One SchedulingBooking. One final confirmation.

Example confirmation:

`Perfect — you're scheduled for Tuesday, September 15 from 9–11 AM at 8233 Tazewell Pike.`

If Book is called twice, HighLevel retries, or start-scheduling is triggered twice, ContractorYou reuses the same Job / SchedulingBooking and does not send a second confirmation.

## HighLevel Regina ownership

ContractorYou cannot dynamically pause HighLevel Conversation AI per conversation. There is no safe HighLevel API in this integration that turns Regina off for one SMS thread and back on after `BOOKED`.

Required HighLevel-side change:

1. Keep one Conversation AI workflow action: **ContractorYou — Start Scheduling** → `POST /api/agent-tools/start-scheduling`
2. Remove Check / Select / Book as the live Conversation AI sequence
3. After Regina triggers start-scheduling once, she must stop operational scheduling talk
4. Do not tell the customer they are booked
5. Do not send a duplicate confirmation
6. After the customer is booked, Regina may resume normal non-scheduling conversation

The production guard is ContractorYou inbound routing: while a session is active, ContractorYou is authoritative for scheduling replies even if HighLevel also receives the SMS.

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

HighLevel string values are accepted: `send_to_customer: "true"`, `phone` instead of `customer_phone`, `reply` instead of `customer_reply`, and `concern` instead of `service_need`.

Map these top-level fields when present:

- `availability_found`
- `available_slots_text`
- `slot_1_display` / `slot_1_token` through `slot_4_*`
- `requires_customer_name`
- `requires_service_address`
- `requires_property_selection`
- `requires_office`
- `booking_confirmed`
- `appointment_display`
- `agent_instruction`
- `error_code`
- `customer_message`
- `scheduling_phase`

## Environment

Slot tokens are signed with one of these existing server secrets (names only):

- `SESSION_SECRET`
- `INTEGRATION_SECRET`
- `AGENT_TOOL_SLOT_SECRET` (optional override)

No Agent Tool secret belongs in client-side JavaScript or git.
