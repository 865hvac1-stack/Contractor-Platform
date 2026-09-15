# Technician Intelligence

Technician Intelligence is the qualification, field-strength, preference, and measured-performance layer used by future Smart Dispatch. It does not schedule, route, map, calculate payroll, or rank employees publicly.

## Rules

1. Eligibility is evaluated before ranking.
2. A required qualification must be active and unexpired. Historical performance can never override a missing or expired requirement.
3. Owner evaluation and ContractorYou performance are stored and displayed separately.
4. Preferences and development call types are soft signals.
5. Empty or sparse samples display insufficient/early data.
6. Reasons are deterministic codes, not generated conclusions.

## Performance definitions

- **Completed jobs:** completed, non-canceled jobs with an explicit technician assignment and a canonical call-type match. Explicit callback visits are excluded from the original-job denominator.
- **Recognized revenue:** non-draft, non-void invoice value linked to eligible completed jobs.
- **Average ticket:** recognized revenue divided by linked eligible invoices. No invoices means no metric.
- **Callback rate:** original completed jobs with an explicit `CALLBACK` relationship divided by eligible original completed jobs. Dates, labels, and proximity are not used to guess callbacks.
- **First-time completion:** eligible original completed jobs without an explicit callback relationship divided by eligible original completed jobs.
- **Estimate conversion:** approved estimates divided by linked estimates that reached a presented/final state.
- **Duration:** checked-in to checked-out time. Missing, non-positive, and durations over 24 hours are excluded.
- **Familiarity:** prior completed, explicitly assigned jobs for the customer/property; equipment familiarity additionally requires an equipment-linked job photo.

Confidence thresholds are centralized in `src/lib/technician-intelligence/core.ts`:

- fewer than 5 jobs: `INSUFFICIENT`
- 5–19: `LOW`
- 20–49: `MEDIUM`
- 50 or more: `HIGH`

## Smart Dispatch contract

`getTechnicianJobFit({ companyId, technicianId, jobId })` returns:

- `eligible`
- hard-constraint status
- required qualifications and current qualification state
- owner skill fit
- canonical call-type performance and confidence
- preferences and overrides
- customer, property, and equipment familiarity
- structured reason codes with human-friendly labels
- empty placeholders for location, drive time, schedule impact, workload, overtime risk, and Parts Bank readiness

`isTechnicianEligibleForJob()` provides the hard-constraint result. `getEligibleTechniciansForJob()` returns active tenant technicians who pass those constraints.

The next Smart Dispatch build can add routing dimensions to `futureDimensions` without changing the Technician Intelligence contract.

## Refresh

Job completion refreshes only the completed job's canonical category for assigned technicians across 30-day, 90-day, year, and all-time windows. Dispatch reads indexed aggregate rows rather than scanning job history.

Manual refresh is available from the profile for data repair and operational review.
