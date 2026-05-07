/**
 * Optimized Zapier Code action: process a Samsara fleet route.
 *
 * Improvements over the previous version:
 *   - Uses `stop.address.id` from the route response, not name matching, so duplicate
 *     address names cannot cross-link stops to the wrong record.
 *   - Looks up existing form submissions through `/form-submissions/stream` with
 *     `assignedToRouteStopIds` + `formTemplateIds`. The previous version called
 *     `/form-submissions?routeStopId=...`, which is not a valid query parameter
 *     and always 400s.
 *   - Fetches each unique address once via `/addresses/{id}` instead of paging the
 *     entire org address book on every run.
 *   - Patches only `{ id, addressId, notes }` on changed stops, matching the
 *     `UpdateRoutesStopRequestObjectRequestBody` schema. The previous version
 *     spread the GET response back into a JSON Merge Patch, which sent
 *     unsupported fields (`forms`, `state`, `actualArrivalTime`, `address`, ...)
 *     and dropped `addressId`.
 *   - Removes the JSON marker lines in `route.notes`. The route notes field is
 *     capped at 2000 characters; the live form-submission lookup is now the
 *     source of truth for idempotency, so markers are unnecessary.
 *   - Throttles to stay under the documented 100 requests/min limit on
 *     `POST /form-submissions` and `PATCH /fleet/routes/{id}`.
 *   - Treats `lockboxFormTemplateId` and `sampleFormTemplateId` as required
 *     inputs. They are org-specific UUIDs and have no safe global default.
 *   - Lockbox tag matching accepts an optional id (numeric, org-specific) and a
 *     case-insensitive name (default `"Lockbox"`); either can match.
 */

interface ProcessSamsaraRouteInput {
  routeId: string;
  lockboxFormTemplateId: string;
  sampleFormTemplateId: string;
  lockboxTagId?: string;
  lockboxTagName?: string;
  formLookupLookbackDays?: number;
  interRequestDelayMs?: number;
}

type FormStatus =
  | "notAttempted"
  | "notApplicable"
  | "missingStopId"
  | "missingAddress"
  | "addressFetchError"
  | "notRequired"
  | "existing"
  | "created"
  | "error";

interface StopDetail {
  stopId: string;
  name: string;
  isMiddleStop: boolean;
  skipReason: string | null;
  addressId: string | null;
  matchedAddressName: string | null;
  tags: string[];
  notesUpdated: boolean;
  lockboxFormStatus: FormStatus;
  sampleFormStatus: FormStatus;
}

interface ProcessSamsaraRouteResult {
  routeId: string;
  totalStops: number;
  middleStops: number;
  notesUpdated: number;
  lockboxFormsCreated: number;
  sampleFormsCreated: number;
  formsAlreadyPresent: number;
  errors: string[];
  stopDetails: StopDetail[];
}

const BASE_URL = "https://api.samsara.com";
const STOP_NOTES_MAX = 2000;
const TITLE_MAX = 255;

export async function processSamsaraRoute(
  input: ProcessSamsaraRouteInput
): Promise<ProcessSamsaraRouteResult> {
  const {
    routeId,
    lockboxFormTemplateId,
    sampleFormTemplateId,
    lockboxTagId,
    lockboxTagName = "Lockbox",
    formLookupLookbackDays = 30,
    interRequestDelayMs = 700,
  } = input;

  if (!routeId) throw new Error("routeId is required");
  if (!lockboxFormTemplateId) throw new Error("lockboxFormTemplateId is required");
  if (!sampleFormTemplateId) throw new Error("sampleFormTemplateId is required");

  const errors: string[] = [];
  const stopDetails: StopDetail[] = [];
  let notesUpdated = 0;
  let lockboxFormsCreated = 0;
  let sampleFormsCreated = 0;
  let formsAlreadyPresent = 0;

  // 1. Fetch the route.
  let stops: any[] = [];
  try {
    const res = await fetchWithZapier(
      `${BASE_URL}/fleet/routes/${encodeURIComponent(routeId)}`
    );
    await res.throwErrorIfNotOk();
    const body = await res.json();
    stops = body?.data?.stops ?? [];
  } catch (e: any) {
    errors.push(`Failed to fetch route ${routeId}: ${describe(e)}`);
    return summary();
  }

  const totalStops = stops.length;
  if (totalStops < 3) {
    for (const s of stops) stopDetails.push(buildDetail(s, false, "terminalStop"));
    return summary();
  }

  // 2. Identify middle stops with valid IDs.
  const middleStops = stops.slice(1, -1);
  const middleStopIds = middleStops
    .map((s) => (s?.id ? String(s.id) : ""))
    .filter(Boolean);

  // 3. Bulk-load existing submissions for both templates across all middle stops.
  const existingFormsByStop = await loadExistingForms(
    middleStopIds,
    [lockboxFormTemplateId, sampleFormTemplateId],
    formLookupLookbackDays,
    errors
  );

  // 4. Fetch each unique address once (parallel).
  const uniqueAddressIds = unique(
    middleStops
      .map((s) => (s?.address?.id ? String(s.address.id) : ""))
      .filter(Boolean)
  );
  const addressById = await loadAddresses(uniqueAddressIds, errors);

  // 5. Walk every stop in order so output ordering is stable.
  const stopPatches: Array<{ id: string; addressId: string; notes: string }> = [];

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const isMiddle = i > 0 && i < stops.length - 1;

    if (!isMiddle) {
      stopDetails.push(buildDetail(stop, false, "terminalStop"));
      continue;
    }

    const detail = buildDetail(stop, true, null);

    if (!detail.stopId) {
      detail.skipReason = "missingStopId";
      detail.lockboxFormStatus = "missingStopId";
      detail.sampleFormStatus = "missingStopId";
      stopDetails.push(detail);
      continue;
    }

    if (!detail.addressId) {
      detail.skipReason = "missingAddress";
      detail.lockboxFormStatus = "missingAddress";
      detail.sampleFormStatus = "missingAddress";
      stopDetails.push(detail);
      continue;
    }

    const address = addressById.get(detail.addressId);
    if (!address) {
      detail.lockboxFormStatus = "addressFetchError";
      detail.sampleFormStatus = "addressFetchError";
      stopDetails.push(detail);
      continue;
    }

    detail.matchedAddressName = address?.name ?? null;
    detail.tags = (Array.isArray(address?.tags) ? address.tags : [])
      .map((t: any) => t?.name || t?.id)
      .filter(Boolean)
      .map(String);

    // 5a. Notes: append address notes to the stop if missing, capped at 2000 chars.
    const addressNotes = String(address?.notes ?? "").trim();
    const existingNotes = String(stop?.notes ?? "");
    if (addressNotes && !existingNotes.includes(addressNotes)) {
      const merged = existingNotes
        ? `${existingNotes}\n\n${addressNotes}`
        : addressNotes;
      const truncated =
        merged.length > STOP_NOTES_MAX ? merged.slice(0, STOP_NOTES_MAX) : merged;
      stopPatches.push({
        id: detail.stopId,
        addressId: detail.addressId,
        notes: truncated,
      });
      detail.notesUpdated = true;
      notesUpdated++;
    }

    const existing = existingFormsByStop.get(detail.stopId) ?? new Set<string>();

    // 5b. Lockbox form (only when the linked address carries the lockbox tag).
    if (!hasLockboxTag(address, lockboxTagId, lockboxTagName)) {
      detail.lockboxFormStatus = "notRequired";
    } else if (existing.has(lockboxFormTemplateId)) {
      detail.lockboxFormStatus = "existing";
      formsAlreadyPresent++;
    } else {
      const ok = await createFormSubmission({
        stopId: detail.stopId,
        templateId: lockboxFormTemplateId,
        title: `Lockbox Form - ${detail.name}`.slice(0, TITLE_MAX),
        isRequired: true,
      });
      if (ok) {
        detail.lockboxFormStatus = "created";
        existing.add(lockboxFormTemplateId);
        lockboxFormsCreated++;
      } else {
        detail.lockboxFormStatus = "error";
      }
      await sleep(interRequestDelayMs);
    }

    // 5c. Sample form (every matched middle stop).
    if (existing.has(sampleFormTemplateId)) {
      detail.sampleFormStatus = "existing";
      formsAlreadyPresent++;
    } else {
      const ok = await createFormSubmission({
        stopId: detail.stopId,
        templateId: sampleFormTemplateId,
        isRequired: true,
      });
      if (ok) {
        detail.sampleFormStatus = "created";
        existing.add(sampleFormTemplateId);
        sampleFormsCreated++;
      } else {
        detail.sampleFormStatus = "error";
      }
      await sleep(interRequestDelayMs);
    }

    existingFormsByStop.set(detail.stopId, existing);
    stopDetails.push(detail);
  }

  // 6. Patch the route once with the modified stop notes (only changed stops).
  if (stopPatches.length > 0) {
    try {
      const res = await fetchWithZapier(
        `${BASE_URL}/fleet/routes/${encodeURIComponent(routeId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stops: stopPatches }),
        }
      );
      await res.throwErrorIfNotOk();
    } catch (e: any) {
      errors.push(`Failed to update stop notes on route ${routeId}: ${describe(e)}`);
    }
  }

  return summary();

  // -- inner helpers (closed over the local accumulators) --

  function summary(): ProcessSamsaraRouteResult {
    return {
      routeId,
      totalStops: stops.length,
      middleStops: middleStops?.length ?? 0,
      notesUpdated,
      lockboxFormsCreated,
      sampleFormsCreated,
      formsAlreadyPresent,
      errors,
      stopDetails,
    };
  }

  async function createFormSubmission(args: {
    stopId: string;
    templateId: string;
    title?: string;
    isRequired?: boolean;
  }): Promise<boolean> {
    const payload: Record<string, unknown> = {
      routeStopId: args.stopId,
      status: "notStarted",
      formTemplate: { id: args.templateId },
    };
    if (args.title) payload.title = args.title;
    if (args.isRequired !== undefined) payload.isRequired = args.isRequired;

    try {
      const res = await fetchWithZapier(`${BASE_URL}/form-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await res.throwErrorIfNotOk();
      return true;
    } catch (e: any) {
      errors.push(
        `Failed to create form submission (template ${args.templateId}) for stop ${args.stopId}: ${describe(e)}`
      );
      return false;
    }
  }
}

// -- module-scope helpers --

function buildDetail(
  stop: any,
  isMiddle: boolean,
  skipReason: string | null
): StopDetail {
  return {
    stopId: stop?.id ? String(stop.id) : "",
    name: stop?.name ?? "",
    isMiddleStop: isMiddle,
    skipReason,
    addressId: stop?.address?.id ? String(stop.address.id) : null,
    matchedAddressName: stop?.address?.name ?? null,
    tags: [],
    notesUpdated: false,
    lockboxFormStatus: isMiddle ? "notAttempted" : "notApplicable",
    sampleFormStatus: isMiddle ? "notAttempted" : "notApplicable",
  };
}

function hasLockboxTag(
  address: any,
  lockboxTagId: string | undefined,
  lockboxTagName: string
): boolean {
  const tags: any[] = Array.isArray(address?.tags) ? address.tags : [];
  const targetName = lockboxTagName.trim().toLowerCase();
  return tags.some((t) => {
    const idMatch =
      lockboxTagId && t?.id && String(t.id) === String(lockboxTagId);
    const nameMatch =
      targetName && t?.name && String(t.name).trim().toLowerCase() === targetName;
    return Boolean(idMatch || nameMatch);
  });
}

async function loadExistingForms(
  stopIds: string[],
  templateIds: string[],
  lookbackDays: number,
  errors: string[]
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (stopIds.length === 0 || templateIds.length === 0) return out;

  const startTime = new Date(
    Date.now() - lookbackDays * 24 * 3600 * 1000
  ).toISOString();

  // Both filters cap at 50 IDs per request.
  for (const stops of chunk(stopIds, 50)) {
    for (const templates of chunk(templateIds, 50)) {
      let cursor = "";
      let hasNext = true;
      while (hasNext) {
        const params = new URLSearchParams({
          startTime,
          assignedToRouteStopIds: stops.join(","),
          formTemplateIds: templates.join(","),
        });
        if (cursor) params.set("after", cursor);

        try {
          const res = await fetchWithZapier(
            `${BASE_URL}/form-submissions/stream?${params.toString()}`
          );
          await res.throwErrorIfNotOk();
          const body = await res.json();
          for (const sub of body?.data ?? []) {
            const stopId = sub?.routeStopId ? String(sub.routeStopId) : "";
            const templateId = sub?.formTemplate?.id
              ? String(sub.formTemplate.id)
              : "";
            if (!stopId || !templateId) continue;
            const set = out.get(stopId) ?? new Set<string>();
            set.add(templateId);
            out.set(stopId, set);
          }
          hasNext = Boolean(body?.pagination?.hasNextPage);
          cursor = String(body?.pagination?.endCursor ?? "");
          if (!cursor) hasNext = false;
        } catch (e: any) {
          errors.push(`Failed to load existing form submissions: ${describe(e)}`);
          hasNext = false;
        }
      }
    }
  }
  return out;
}

async function loadAddresses(
  addressIds: string[],
  errors: string[]
): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  await Promise.all(
    addressIds.map(async (id) => {
      try {
        const res = await fetchWithZapier(
          `${BASE_URL}/addresses/${encodeURIComponent(id)}`
        );
        await res.throwErrorIfNotOk();
        const body = await res.json();
        const addr = body?.data ?? body;
        if (addr) out.set(id, addr);
      } catch (e: any) {
        errors.push(`Failed to fetch address ${id}: ${describe(e)}`);
      }
    })
  );
  return out;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0 || arr.length === 0) return arr.length ? [arr] : [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(e: any): string {
  return e?.message ? String(e.message) : String(e);
}
