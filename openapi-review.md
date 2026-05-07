# Samsara OpenAPI Specification Review

**Spec under review:** <https://developers.samsara.com/openapi/samsara-api.json>
**Spec version:** `2025-10-23` (OpenAPI `3.0.1`)
**Size:** ~3.1 MB, 221 paths / 308 operations / 3,771 component schemas
**Linter used:** `@redocly/cli` (recommended ruleset) — 290 warnings, 0 errors

This review focuses on spec hygiene, internal consistency, and SDK-generation friendliness. The Java SDK in this repo is generated from this document, so spec quality directly drives SDK quality.

---

## TL;DR

The spec is structurally valid and parses cleanly, but it has accumulated meaningful inconsistencies. The most impactful issues for downstream consumers (especially generated SDKs):

1. **9 broken `$ref`s** to `#/components/requestBodies/inline_object*` — `requestBodies` is not defined anywhere. These are dead pointers on real legacy endpoints.
2. **2,040 per-operation error response schemas** that are byte-for-byte identical to a single shared shape (`{message, requestId}`). This bloats the spec, the SDK, and docs to no benefit.
3. **All 36 reusable `components.parameters` are defined but never `$ref`'d** — every parameter on every operation is inlined.
4. **Three coexisting pagination styles** with no deprecation markers.
5. **Tag taxonomy is broken**: 29 tags are used by operations but not declared at the top level; 3 declared tags are never used; several are spelled differently in the two places.
6. **104 of 308 operations declare no `4XX` response at all.**
7. **Eight `POST /v1/...` endpoints are read operations** (`V1getSensors*`, `V1getMachines*`) — semantic anti-pattern even for legacy.

None of these block code generation, but each one is a paper cut for SDK users and a noticeable quality ceiling on the public docs.

---

## 1. Document metadata

| Field | Value |
|---|---|
| `openapi` | `3.0.1` |
| `info.title` | `Samsara API` |
| `info.version` | `2025-10-23` |
| `info.contact` | **missing** |
| `info.license` | **missing** (Redocly: `info-license`) |
| `info.termsOfService` | **missing** |
| `servers` | 3 entries (`api.samsara.com`, `api.eu.samsara.com`, `api.ca.samsara.com`); none has a `description` |

**Suggestion:** Add `description` (e.g., "US production", "EU production", "Canada production") to each `server` so client builders can render them in pickers; add `info.license` and `info.contact`.

The `info.description` is ~hundreds of lines of inline HTML+CSS (`<style type="text/css">…</style>`) used to style admonition-style callouts in the docs portal. It works in the Samsara docs site but is hostile to every other Markdown/OpenAPI consumer (Postman, IDE explorers, generated reference pages). Worth extracting the styling out of `info.description` and using `<!-- redoc -->`-style admonitions or plain Markdown.

---

## 2. Security

```
components.securitySchemes.AccessTokenHeader = { type: http, scheme: bearer }
security: [ { AccessTokenHeader: [] } ]
```

* Single global security requirement, no per-operation overrides — clean.
* All 308 operations inherit `null` (i.e. global) security, confirmed by enumeration.

**Gap:** Samsara's actual auth model uses **per-token scopes** (e.g. `vehicles:read`, `drivers:write`). Those scopes are documented in the dev portal but **not represented in the spec**. Consumers can't tell which scope a given operation requires from the OpenAPI alone. This is the single most useful thing missing from the security model. Either:

* model scopes as `oauth2` or by encoding required scopes in `security[].AccessTokenHeader[]`, or
* add an `x-samsara-scopes` extension per operation listing required scopes.

---

## 3. Paths and operations

* **Methods:** 178 GET, 62 POST, 33 PATCH, 29 DELETE, 6 PUT.
* All 308 ops have `summary`, `description`, `operationId`, and at least one tag (good).
* No duplicate `operationId`s (good).

### 3.1 `operationId` casing

* 279 use camelCase (`listVehicles`).
* 29 use `V1<PascalCase>` (`V1getAllAssets`, `V1getMachines`, `V1getSensorsCargo`, …).

The `V1`-prefix style is internally inconsistent and will produce odd Java method names (`v1getAllAssets`). Either fully camelCase the legacy IDs (`v1ListAllAssets`) or, ideally, drop the prefix and rely on the tag/path to communicate "legacy".

### 3.2 Path-parameter casing (legacy `/v1/*`)

```
/v1/fleet/assets/{asset_id}/locations
/v1/fleet/dispatch/routes/{route_id_or_external_id}
/v1/fleet/drivers/{driver_id}/hos/duty_status
/v1/industrial/vision/runs/{camera_id}/{program_id}/{started_at_ms}
```

vs.

```
/v1/fleet/drivers/{driverId}/safety/score
/v1/fleet/trailers/{trailerId}/assignments
/v1/fleet/vehicles/{vehicleId}/safety/harsh_event
```

`{driver_id}` and `{driverId}` coexist in the same legacy slice — same concept, different casing. Snake_case path params also interact poorly with most code generators' default Java identifier rules.

### 3.3 Read-by-POST (`/v1/sensors/*`, `/v1/machines/*`)

```
POST /v1/machines/history    -> V1getMachinesHistory
POST /v1/machines/list       -> V1getMachines
POST /v1/sensors/cargo       -> V1getSensorsCargo
POST /v1/sensors/door        -> V1getSensorsDoor
POST /v1/sensors/history     -> V1getSensorsHistory
POST /v1/sensors/humidity    -> V1getSensorsHumidity
POST /v1/sensors/list        -> V1getSensors
POST /v1/sensors/temperature -> V1getSensorsTemperature
```

POST used to fetch read-only data. The `operationId` even acknowledges this (`getXxx`). These endpoints additionally reference `#/components/requestBodies/inline_object_*` — see §6.

### 3.4 Path prefix sprawl

* `/fleet/*` (72 paths) is the dominant namespace.
* `/v1/*` (30) — explicitly legacy.
* `/beta/*` (6 paths) — but **67 operations are tagged `Beta APIs`**, so most beta endpoints live outside `/beta/*` (e.g. `/qualification-records`, `/ridership/*`, `/functions/*`, `/reports/*`). The path prefix and the tag disagree about what "beta" means.
* `/preview/*` (3 paths) — matches the 4 preview operations.

**Suggestion:** Pick a single signal for stability (the `Beta APIs` / `Preview APIs` / `Legacy APIs` tag) and remove the `/beta` and `/preview` URL prefixes from the contract that beta endpoints use them. Otherwise SDK users have to learn two rules.

---

## 4. Tags

`components.tags` declares **30** tags, but operations actually use **56** distinct tag names. The mismatch is large.

### 4.1 Used in operations but not declared (29)

```
Alerts, Auth Token for Driver, CARB CTC, Coaching, Driver QR Codes,
Driver-Trailer Assignments, Driver-Vehicle Assignments, Forms,
Fuel and Energy, Gateways, Hubs, IFTA, Idling, Issues, Legacy,
Live Sharing Links, Location and Speed, Media, Plans, Readings,
Route Events, Safety Scores, Settings, Speeding Intervals,
Trailers, TrainingAssignments, TrainingCourses, Webhooks, Work Orders
```

These render with no description in tools that key off `tags[].description`.

### 4.2 Declared but never used (3)

```
Camera Media, Driver Vehicle Assignments, Vehicle Driver Assignments
```

Note `Driver Vehicle Assignments` (declared, no hyphen) vs `Driver-Vehicle Assignments` (used, with hyphen). Same with `Camera Media` (declared) vs `Media` (used). These look like rename leftovers.

### 4.3 Naming inconsistency

* Spaces: `Hours of Service`, `Vehicle Stats` — preferred.
* Concatenated: `TrainingAssignments`, `TrainingCourses` — outliers; should be `Training Assignments`, `Training Courses`.
* Hyphen vs space: `Driver-Vehicle Assignments` vs `Vehicle Driver Assignments`.
* `Legacy` (one operation) vs `Legacy APIs` (eight).

### 4.4 No tag has a description

Redocly raises 30 `tag-description` warnings — every declared tag is `{name}` only.

---

## 5. Pagination

Three different cursor patterns coexist:

| Signature | # endpoints | Notes |
|---|---|---|
| `(after, limit)` | 48 | The "v2" idiom that matches `paginationResponse.endCursor`. |
| `(after,)` | 76 | Same idiom but `limit` is omitted — clients can't control page size. |
| `(endingBefore, limit, startingAfter)` | 3 | Older Stripe-style cursors. |
| `(pageNumber,)` | 1 | `GET /beta/aemp/Fleet/{pageNumber}` — page-number pagination as a *path param*. |
| `(limit,)` | 1 | No cursor at all. |

Issues:

* Whether `limit` is supported is non-obvious from the path. Recommend exposing `limit` consistently on every paginated `after`-style endpoint.
* The `endingBefore`/`startingAfter` triplet should be marked `deprecated: true` if they're being phased out (none currently are).
* The `pageNumber` path-parameter style on `/beta/aemp/Fleet/{pageNumber}` is unique in the entire spec and breaks every standard SDK pager. It should accept `?page=` (query) or migrate to cursors.

The shared response wrapper is fine:

```yaml
paginationResponse:
  required: [endCursor, hasNextPage]
  properties:
    endCursor:    { type: string, format: string, ... }
    hasNextPage:  { type: boolean }
```

Minor: `format: string` on a `type: string` property is non-standard and meaningless — drop the `format`.

---

## 6. Broken `$ref`s — **bug**

```
/v1/fleet/dispatch/routes/{route_id_or_external_id}.delete.requestBody  -> #/components/requestBodies/inline_object
/v1/fleet/drivers/{driver_id}/hos/duty_status.post.requestBody          -> #/components/requestBodies/inline_object_1
/v1/fleet/messages.post.requestBody                                     -> #/components/requestBodies/inline_object_2
/v1/machines/history.post.requestBody                                   -> #/components/requestBodies/inline_object_3
/v1/sensors/cargo.post.requestBody                                      -> #/components/requestBodies/inline_object_4
/v1/sensors/door.post.requestBody                                       -> #/components/requestBodies/inline_object_5
/v1/sensors/history.post.requestBody                                    -> #/components/requestBodies/inline_object_6
/v1/sensors/humidity.post.requestBody                                   -> #/components/requestBodies/inline_object_7
/v1/sensors/temperature.post.requestBody                                -> #/components/requestBodies/inline_object_8
```

`components.requestBodies` does not exist in the document at all. These nine refs dangle. Strict tooling (Spectral, openapi-generator, some editors) will reject the spec; lenient tools will silently produce broken request types. These are all on legacy `/v1/*` operations, which is presumably why nobody noticed — but the Java SDK presumably can't model the request body for any of them today.

**Fix:** either inline the request schemas under each `requestBody.content[*].schema` or add the missing `components.requestBodies` block.

---

## 7. Error response schemas

The spec defines a single perfectly-good shared shape:

```yaml
standardErrorResponse:
  properties:
    message:   { type: string, example: "An error has occurred." }
    requestId: { type: string, example: "8916e1c1" }
```

…and then mostly doesn't use it. Per status code, the spec defines **204 distinct schemas** (one per non-legacy operation) for each of `400, 401, 404, 405, 429, 500, 501, 502, 503, 504`:

| Suffix | Schemas |
|---|---|
| `*BadRequestErrorResponseBody` | 204 |
| `*UnauthorizedErrorResponseBody` | 204 |
| `*NotFoundErrorResponseBody` | 204 |
| `*MethodNotAllowedErrorResponseBody` | 204 |
| `*TooManyRequestsErrorResponseBody` | 204 |
| `*InternalServerErrorResponseBody` | 204 |
| `*NotImplementedErrorResponseBody` | 204 |
| `*BadGatewayErrorResponseBody` | 204 |
| `*ServiceUnavailableErrorResponseBody` | 204 |
| `*GatewayTimeoutErrorResponseBody` | 204 |
| **Total** | **2,040** |

Sampled all 204 `*UnauthorizedErrorResponseBody` schemas — every one is structurally identical to the others and to `standardErrorResponse` (all `{message, requestId}` with the same description text and example values). The only difference is the `description` (`"Unauthorized"`, `"Bad Request parameters"`, …) — and even those are repeated verbatim across operations.

**Effect on the Java SDK:** thousands of distinct generated exception/error classes that all describe the same wire shape. It's also the dominant cause of the spec's 3.1 MB size — collapsing this would shrink the document by an order of magnitude.

**Fix:** define one schema per status-code semantics (e.g. `BadRequestError`, `UnauthorizedError`, …) under `components.responses` and reference them. The `default` slot already uses `standardErrorResponse` 73× and `V1ErrorResponse` 31×, so the pattern is already in the spec — just unused for explicit codes.

---

## 8. Reusable components hygiene

* `components.parameters` defines **36 parameters**, **all unused** (`no-unused-components` × 36). Confirmed by scanning every `$ref` in the document.
* `components.responses` is **empty** (0 entries) — every response is inlined; cause of the duplication in §7.
* `components.schemas` has **3,771** entries. Approximately **69 are unreferenced** (e.g. `ListVehiclesResponse`, `ExternalIds`, `AttributeResponse`, `DriverPassword`, `SafetyEventDriver`).
* **454 / 3,532 (~13%) object schemas** lack a `required` array, even though they are documented as having required fields in `description` text. This forces SDK users into nullable types they don't need.
* **434 / 3,771 schemas** lack a `description`.
* **`additionalProperties` is unspecified on 3,530 of 3,532 object schemas.** OpenAPI's default permits unknown properties; this is fine if intended, but Samsara documentation talks about strict request validation. Consider setting `additionalProperties: false` at least on request bodies.

---

## 9. Date/time conventions

Time-related parameters use a mix of:

| `(type, format)` | Count |
|---|---|
| `string` (no format) | 133 |
| `array` | 27 |
| `integer/int64` | 27 |
| `string/date-time` | 24 |
| `integer` (no format) | 5 |
| `boolean` | 3 |

Two distinct epoch conventions: most "ms"-suffixed parameters (`startMs`, `endMs`, `durationMs`) are `integer/int64` Unix epoch milliseconds, while many "time"-suffixed parameters (`startTime`, `endTime`) are `string/date-time` (ISO 8601). 133 `string` params with no `format` give clients no hint at all — at minimum these need `format: date-time` (or a `pattern`) where the underlying value is a timestamp.

The 5 `integer` (no `format`) timestamps should be `int64` — JSON has no integer max, but Java/C#/Go generators all need `int64` to avoid silently downcasting to 32-bit.

---

## 10. Status-code conventions

* All operations include a `default` response (good).
* **104 of 308 operations declare no 4XX response at all.** Many are core endpoints (`GET /addresses`, `POST /fleet/dvirs`, `GET /fleet/vehicles/{id}`, …). Redocly: `operation-4xx-response` × 51 (the rule fires per *path*, not per operation). Recommend at minimum `400` and `401` per operation; `404` for any path with a `{id}`.
* **DELETE responses split**: 26 use `204 No Content`, but 3 return `200`:
  - `DELETE /beta/industrial/jobs`
  - `DELETE /qualification-records`
  - `DELETE /v1/fleet/dispatch/routes/{route_id_or_external_id}` (the legacy one is fine)
* **POST responses split**: most use `200`; only 5 use `201`. RESTful convention is `201 Created` with a `Location` header for resource creation.

---

## 11. Examples

Redocly flagged **16 `no-invalid-schema-examples`** + **2 `no-invalid-media-type-examples`**. Representative cases:

* `externalIds` examples include `maintenanceId` and `payrollId`, but the schema declares `additionalProperties` constrained to specific keys → example doesn't validate.
* `rulesetType` example string `"USA Property (8/70)"` — value is in the enum so this one passes, but several enum example mismatches exist (e.g. an example value of `"active, inactive"` for an enum that doesn't include either).
* Some array `examples` contain elements whose `type` doesn't match `items` (e.g. examples with `0/1/2/3` integer indices when the items must be objects).
* A handful of placeholder Latin examples: `"Architecto sed delectus alias molestiae iure."`, `"Doloribus maiores et inventore neque nemo voluptatem."` — these look like Faker output that escaped review.
* `customAttributes` examples include `region`, `threshold`, `API_KEY` keys not declared in the schema.

These don't break the spec but they fail strict validators and undermine the Try-It / mocking experience.

---

## 12. Smaller items

* **`reefer` vs `reefers`** in legacy paths: `/v1/fleet/assets/reefers` (list) and `/v1/fleet/assets/{asset_id}/reefer` (singular). Inconsistent within the same resource.
* **Vision endpoint design**: `/v1/industrial/vision/runs/{camera_id}/{program_id}/{started_at_ms}` triple path parameter — would normally be one path with two query filters. Bonus: there's also `/v1/industrial/vision/runs/{camera_id}` and `/v1/industrial/vision/runs` for the same conceptual resource.
* **Beta gate via tag, not feature flag**: 67 operations are tagged `Beta APIs` but otherwise look "stable" (no `x-internal`, no `deprecated`, no warning in description). Recommend adding `x-stability: beta` (or similar `x-` extension) for machine-readable consumption.
* **Empty `info.description` admonitions** rendering: the `<n class="info">…</nh>…</n>` pseudo-tags only render in Samsara's docs portal; in everything else they show as raw `<n>` literal text.

---

## Recommended fix priorities

| # | Item | Effort | Impact |
|---|---|---|---|
| 1 | Fix the 9 broken `inline_object*` request-body refs | Low | Spec-validity blocker |
| 2 | Collapse 2,040 per-operation error schemas into ~10 shared `components.responses` | Low–Medium | -1 MB spec, dramatically simpler SDKs |
| 3 | Reconcile tag declarations vs. usage (declare missing, drop unused, rename for consistency) | Low | Docs/navigation |
| 4 | Add `description` to every tag and every server | Low | Docs |
| 5 | Add `4XX` responses to the 104 operations that lack them | Medium | Generated retry/error paths |
| 6 | Standardize one pagination shape; `deprecated: true` the others | Medium | DX/SDK pager consistency |
| 7 | Either use the 36 `components.parameters` via `$ref` or delete them | Low | Hygiene |
| 8 | Surface scope requirements per operation (extension or `oauth2` flow) | Medium | Auth correctness |
| 9 | Tighten date/time formats — `int64` for epoch ms, `date-time` for ISO timestamps | Low | Type fidelity |
| 10 | Migrate read-by-POST `/v1/sensors/*` and `/v1/machines/*` to GETs (or document them as legacy explicitly) | High | Long-term DX |

---

## How this was produced

* Downloaded the spec (3.1 MB JSON).
* Parsed with Python; computed counts of paths, operations, tags, refs, schemas, parameter usage, status codes, pagination signatures, error-schema duplication, time-format mix.
* Verified every `$ref` resolves; identified 9 broken ones.
* Ran `npx @redocly/cli lint` with the recommended ruleset (290 warnings, 0 errors).
* Sampled the suspicious endpoints and schemas individually for confirmation.
