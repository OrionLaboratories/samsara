# Zapier Custom Action: `processSamsaraRoute`

This document describes the behavior of the custom Zapier action `processSamsaraRoute`, which automates the enrichment of a Samsara fleet route with address-derived notes and form submissions for delivery stops. It is intended for operations teams who use Samsara routing alongside Samsara Forms to capture lockbox and sample workflows on each visit.

## Purpose

Given a single Samsara route ID, the action:

1. Loads the route and every address in the Samsara account.
2. Matches each non-terminal stop to an address by exact name (case-insensitive).
3. Copies address notes onto the matched stop.
4. Creates a **Lockbox** form submission for stops whose matched address carries the `Lockbox` tag.
5. Creates a **Sample** form submission for every matched stop.
6. Records what it has already done in the route's `notes` field so subsequent runs are idempotent.

The action returns a structured summary (counts, error list, per-stop detail) suitable for downstream Zap steps, dashboards, or error notifications.

## Inputs

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `routeId` | `string` | Yes | — | The Samsara fleet route ID to process. |
| `lockboxFormTemplateId` | `string` | No | `9b8f6bd7-c078-4f33-a680-ce1c8ff048fa` | Form template ID used when creating Lockbox form submissions. |
| `sampleFormTemplateId` | `string` | No | `959f956d-67a6-41b0-8040-ba2c9d5e10f0` | Form template ID used when creating Sample form submissions. |

Internal constants:

- `baseUrl`: `https://api.samsara.com`
- `lockboxTagId`: `5624183`
- `lockboxTagName`: `Lockbox`

All HTTP traffic is issued through Zapier's `fetchWithZapier` helper, which transparently attaches the configured Samsara authentication for the Zap account.

## Outputs

The action resolves with an object shaped as follows:

| Field | Type | Description |
| --- | --- | --- |
| `routeId` | `string` | Echo of the input route ID. |
| `totalStops` | `number` | Total number of stops on the route (including terminal stops). |
| `addressMatches` | `number` | Number of middle stops that matched an address by name. |
| `notesUpdated` | `number` | Number of stops whose `notes` were enriched from the matched address. |
| `lockboxFormsCreated` | `number` | Number of Lockbox form submissions created on this run. |
| `sampleFormsCreated` | `number` | Number of Sample form submissions created on this run. |
| `alreadyProcessed` | `string[]` | Tokens like `"<stopId>:lockbox"` or `"<stopId>:sample(existing)"` describing which stop/form pairs were skipped. |
| `errors` | `string[]` | Human-readable messages for any non-fatal failures (form creation errors, route patch errors, route fetch errors). |
| `stopDetails` | `any[]` | Per-stop diagnostic record (see below). |

Each entry in `stopDetails` includes:

- `stopId`, `name`
- `isMiddleStop` — whether the stop is eligible for processing (i.e. not the first or last on the route).
- `processedPreviously` / `processedThisRun` — duplicate-prevention flags.
- `skipReason` — one of `terminalStop`, `missingStopId`, `alreadyProcessed`, or `null` when the stop was processed.
- `hasMatch`, `matchedAddressName`, `tags`
- `notesUpdated` — boolean indicating notes were merged for this stop.
- `lockboxFormStatus` and `sampleFormStatus` — one of `notAttempted`, `notApplicable`, `missingStopId`, `missingStopName`, `addressNotFound`, `notRequired`, `existing`, `alreadyProcessed`, `created`, or `error`.

## Detailed Workflow

### 1. Fetch the Route

The action calls `GET /fleet/routes/{routeId}` to retrieve the route document, including its ordered `stops` array and existing `notes` field. If the route has zero stops, the action returns immediately with the error `"No stops found in route"`.

### 2. Load All Addresses

It iterates `GET /addresses`, following the `pagination.endCursor` / `pagination.hasNextPage` cursor pattern, until every address in the Samsara account has been collected into a single in-memory list. This list is reused for all stop matching that follows.

### 3. Read Idempotency Markers from Route Notes

The function reads three special marker lines from the route's `notes` field to learn what previous runs have already done. Each marker is followed by a JSON-encoded array of stop IDs:

- `STOP_PROCESSING_COMPLETED_V1:` — every stop the action has finished examining.
- `FORMS_PROCESSED:<lockboxFormTemplateId>:` — stops for which a Lockbox form has been confirmed (created or pre-existing).
- `FORMS_PROCESSED:<sampleFormTemplateId>:` — same, for Sample forms.

If the global "completed" marker is missing but the per-form markers exist, the action treats every stop in either of those sets as completed (a backfill for older route notes that only had the form markers).

Helpers `parseMarkerSet` and `upsertMarkerLine` parse and rewrite these lines while leaving any other content in `notes` untouched.

### 4. Iterate Stops

For each stop in order:

#### 4a. Skip Terminal and Invalid Stops
- The first and last stops are flagged `isMiddleStop = false` and skipped (`skipReason = 'terminalStop'`). This avoids creating forms at depots / origin / final-return stops.
- Stops missing an `id` are skipped with `skipReason = 'missingStopId'`.
- Stops whose ID already appears in the global processed set are skipped with `skipReason = 'alreadyProcessed'`. If the stop ID is also in the per-form processed sets, entries like `"<stopId>:lockbox"` or `"<stopId>:sample"` are appended to `alreadyProcessed`.

#### 4b. Match by Stop Name
The action searches `allAddresses` for the first address whose `name` equals the stop's `name` after `trim().toLowerCase()` normalization. Empty names never match. When a match is found, `addressMatches` is incremented.

#### 4c. Collect Existing Form Templates for the Stop
Before creating any new form, the action determines which form templates are already attached to the stop, to avoid creating duplicates:

1. **Inline inspection.** It walks the stop object looking for any of `formSubmissions`, `forms`, `assignedForms`, `formAssignments`, `existingForms`, `formSubmissionStatuses`, plus `tasks[].formSubmissions` and `tasks[].forms`. From each record it reads any of `formTemplate.id`, `formTemplateId`, `templateId`, `template.id`, or `id`.
2. **API fallback.** If nothing was found inline, it queries `GET /form-submissions?routeStopId={stopId}` (and falls back to `routeStopIds={stopId}` if that returns an error), paginating until exhausted. A failure on the first variant causes a graceful retry on the second; a final failure simply yields an empty set.

The resulting set of template IDs is cached per stop ID so a stop is never inspected twice in a single run.

#### 4d. Merge Address Notes onto the Stop
If the matched address has non-empty `notes`, and the stop's existing `notes` do not already contain that text, the address notes are appended (separated by a blank line). `notesUpdated` is incremented for each stop modified this way. The mutation is applied to a stop copy held in `updatedStops`; the route is patched once at the end.

#### 4e. Lockbox Form Decision
The action computes `processedTags`, normalizing the address's `tagIds` or `tags` field into an array of strings (using `name`, `id`, or the raw value as appropriate). It considers the stop "lockbox-eligible" if any of the following match:
- The tag string equals `"5624183"` (the `lockboxTagId`).
- The tag string equals `"Lockbox"` (the `lockboxTagName`).
- Any tag, lower-cased, equals `"lockbox"`.

For lockbox-eligible stops:
- If the stop ID is in the lockbox processed marker set, it is recorded in `alreadyProcessed` as `"<stopId>:lockbox"`; status `alreadyProcessed`.
- Else if `lockboxFormTemplateId` already appears among the stop's existing form templates, the marker set is updated and the stop is recorded as `"<stopId>:lockbox(existing)"`; status `existing`.
- Otherwise, the action issues `POST /form-submissions` with:

  ```json
  {
    "routeStopId": "<rawStopId or stopId>",
    "status": "notStarted",
    "formTemplate": { "id": "<lockboxFormTemplateId>" },
    "title": "Lockbox Form - <stopName>",
    "isRequired": true
  }
  ```

  On success: `lockboxFormsCreated` is incremented, the stop is added to the lockbox processed set, and the cached template set is updated. On failure: an entry is added to `errors` and the per-stop status is `error`.

If the address does not carry a Lockbox tag, the lockbox status becomes `notRequired`.

#### 4f. Sample Form Decision
Sample forms are created for every matched middle stop, regardless of tags:
- If already in the sample processed marker set: status `alreadyProcessed`.
- Else if `sampleFormTemplateId` already appears in the stop's existing forms: marker is updated and status is `existing`.
- Otherwise, `POST /form-submissions` is issued with:

  ```json
  {
    "routeStopId": "<rawStopId or stopId>",
    "status": "notStarted",
    "formTemplate": { "id": "<sampleFormTemplateId>" }
  }
  ```

  On success, `sampleFormsCreated` is incremented and the marker set is updated. On failure, the error message is appended to `errors`.

#### 4g. Record Completion and Throttle
After the per-stop work, the stop ID is added to the global processed set, the detail row is saved, and the loop sleeps `100 ms` before the next stop to limit pressure on the Samsara API.

#### 4h. Stops Without a Match or Without a Name
- If a stop has a non-empty name but no address matches, both form statuses are `addressNotFound`.
- If the stop has no name at all, both form statuses are `missingStopName`.

In both cases the stop is still marked as processed (so subsequent runs do not retry), and no form submissions are created.

### 5. Persist Modified Stop Notes
If any stop notes changed (`notesUpdated > 0`), the action issues `PATCH /fleet/routes/{routeId}` with `{ stops: updatedStops }` to push the merged-notes copy of every stop. A failure here is reported via `errors` but does not abort the run.

### 6. Persist Updated Tracking Markers
If any of the three processed sets were modified, the action rebuilds `notes` using `upsertMarkerLine` (replacing any pre-existing marker line, or appending if none) and issues a separate `PATCH /fleet/routes/{routeId}` with `{ notes: updatedRouteNotes }`. A failure of this update is logged but explicitly marked "non-critical" — the run still returns a successful summary.

### 7. Summary Logging
Before returning, the action prints a console summary with total stops, address matches, notes updated, lockbox forms created, sample forms created, already-processed count, and error count. The same numbers are returned in the result object.

## Idempotency Guarantees

- **Per stop:** Once a stop ID is in the `STOP_PROCESSING_COMPLETED_V1` marker, the stop is fully skipped on later runs (no form lookups, no notes merging).
- **Per form template:** The per-template `FORMS_PROCESSED:` markers and the live form-submission lookup both gate creation, so even if the route notes are wiped a duplicate form will not be created as long as the existing submission can be read from the API.
- **Notes:** Address notes are appended only if the stop's current notes do not already contain that text, so re-running does not duplicate text even before the marker is written.

## Error Handling

- A failure at the route fetch step is fatal: the function records `"Route processing failed: <message>"` and returns with all counters at zero.
- Failures at any other step (address page fetch, form-submission lookup, form creation, route patch) are caught locally and recorded in `errors`. Processing continues for the remaining stops.
- Errors do not throw — every successful invocation yields the same return shape.

## Operational Notes

- Address pagination is unbounded; very large Samsara accounts will incur many `GET /addresses` calls before any per-stop work begins.
- The 100 ms inter-stop delay caps throughput at roughly 10 stops per second before factoring in API latency.
- Matching is by stop name only. If two addresses share the same name, the first one returned by `/addresses` wins. Address selection is order-dependent.
- Terminal stops are intentionally exempt; if a depot also requires a form, the route must include it as a middle stop or the action must be modified.
- Marker lines live in the human-visible `notes` field. Drivers and dispatchers reading the route in Samsara will see lines like `STOP_PROCESSING_COMPLETED_V1:["abc","def"]` unless the field is rendered separately.
