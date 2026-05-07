/**
 * Optimized Zapier Code action: process a Samsara fleet route.
 *
 * For a given routeId this action:
 *   1. Fetches the route, then loads each stop's linked Samsara address (and
 *      the address's tags) via `GET /addresses/{id}`.
 *   2. Copies the address's `notes` onto the stop's `notes` (capped at the
 *      2000-character API limit) when the stop's notes do not already
 *      contain that text.
 *   3. Assigns specimen-pickup form submissions to middle stops, driven by
 *      a tag-to-form rule list. Every rule whose tag matches the stop's
 *      linked address contributes a form submission.
 *   4. Assigns a specimen-delivery form submission to the final stop AND to
 *      any non-first stop whose address carries a depot tag.
 *
 * Idempotency is enforced by a single bulk lookup against
 * `GET /form-submissions/stream` (filtered by `assignedToRouteStopIds` and
 * `formTemplateIds`); existing submissions are not re-created.
 *
 * The route is patched once with `{ stops: [{ id, addressId, notes }, ...] }`
 * for stops whose notes changed. No marker lines are written into the route's
 * `notes` field.
 */

interface PickupFormRule {
  /** Case-insensitive tag name or numeric Samsara tag id. */
  tag: string;
  /** Form template id to assign when a middle stop's address carries `tag`. */
  formTemplateId: string;
}

interface ProcessSamsaraRouteInput {
  routeId: string;
  /** Tag-to-form rules. A stop receives every form whose tag matches. */
  pickupFormRules: PickupFormRule[];
  /** Form template id used for the delivery form. */
  deliveryFormTemplateId: string;
  /** Tag names or ids that mark an address as a depot. Default: ["Depot"]. */
  depotTags?: string[];
  /** Lookback (days) when scanning existing submissions. Default: 30. */
  formLookupLookbackDays?: number;
  /** Delay between mutating requests. Default 700 ms (~85/min, under 100/min). */
  interRequestDelayMs?: number;
}

type FormStatus = "created" | "existing" | "error";
type DeliveryStatus = FormStatus | "notRequired" | "notAttempted";

interface AssignedPickupForm {
  tag: string;
  formTemplateId: string;
  status: FormStatus;
}

interface StopDetail {
  stopId: string;
  name: string;
  position: "start" | "middle" | "end";
  addressId: string | null;
  matchedAddressName: string | null;
  tags: string[];
  isDepot: boolean;
  notesUpdated: boolean;
  pickupFormsAssigned: AssignedPickupForm[];
  deliveryFormStatus: DeliveryStatus;
  skipReason: string | null;
}

interface ProcessSamsaraRouteResult {
  routeId: string;
  totalStops: number;
  notesUpdated: number;
  pickupFormsCreated: number;
  deliveryFormsCreated: number;
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
    pickupFormRules,
    deliveryFormTemplateId,
    depotTags = ["Depot"],
    formLookupLookbackDays = 30,
    interRequestDelayMs = 700,
  } = input;

  if (!routeId) throw new Error("routeId is required");
  if (!deliveryFormTemplateId) throw new Error("deliveryFormTemplateId is required");
  if (!Array.isArray(pickupFormRules)) {
    throw new Error("pickupFormRules must be an array");
  }

  const errors: string[] = [];
  const stopDetails: StopDetail[] = [];
  let notesUpdated = 0;
  let pickupFormsCreated = 0;
  let deliveryFormsCreated = 0;
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

  if (stops.length === 0) {
    errors.push("No stops found on route");
    return summary();
  }

  const stopIds = stops.map((s) => idOf(s)).filter(Boolean);
  const uniqueAddressIds = unique(
    stops.map((s) => idOf(s?.address)).filter(Boolean)
  );

  // 2. Bulk-load existing submissions for every template referenced in the rules
  //    plus the delivery template, scoped to this route's stops.
  const allTemplateIds = unique([
    deliveryFormTemplateId,
    ...pickupFormRules.map((r) => r.formTemplateId),
  ]);
  const existingFormsByStop = await loadExistingForms(
    stopIds,
    allTemplateIds,
    formLookupLookbackDays,
    errors
  );

  // 3. Fetch each unique address once (parallel) — this is where tags and
  //    notes come from.
  const addressById = await loadAddresses(uniqueAddressIds, errors);

  // 4. Walk every stop in order and decide what work it needs.
  const stopPatches: Array<{ id: string; addressId: string; notes: string }> = [];
  const lastIndex = stops.length - 1;

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const position: StopDetail["position"] =
      i === 0 ? "start" : i === lastIndex ? "end" : "middle";
    const detail = buildDetail(stop, position);

    if (!detail.stopId) {
      detail.skipReason = "missingStopId";
      stopDetails.push(detail);
      continue;
    }

    if (!detail.addressId) {
      detail.skipReason = "missingAddress";
      stopDetails.push(detail);
      continue;
    }

    const address = addressById.get(detail.addressId);
    if (!address) {
      detail.skipReason = "addressFetchError";
      stopDetails.push(detail);
      continue;
    }

    detail.matchedAddressName = address?.name ?? detail.matchedAddressName;
    detail.tags = (Array.isArray(address?.tags) ? address.tags : [])
      .map((t: any) => t?.name || t?.id)
      .filter(Boolean)
      .map(String);
    detail.isDepot = addressMatchesAnyTag(address, depotTags);

    // 4a. Notes: append the address's notes to the stop's notes when missing.
    const addressNotes = String(address?.notes ?? "").trim();
    const existingNotes = String(stop?.notes ?? "");
    if (addressNotes && !existingNotes.includes(addressNotes)) {
      const merged = existingNotes
        ? `${existingNotes}\n\n${addressNotes}`
        : addressNotes;
      stopPatches.push({
        id: detail.stopId,
        addressId: detail.addressId,
        notes: merged.slice(0, STOP_NOTES_MAX),
      });
      detail.notesUpdated = true;
      notesUpdated++;
    }

    const existing = existingFormsByStop.get(detail.stopId) ?? new Set<string>();

    // 4b. Pickup forms: middle stops only, one per matching rule.
    if (position === "middle" && pickupFormRules.length > 0) {
      const matchedRules = pickupFormRules.filter((rule) =>
        addressMatchesTag(address, rule.tag)
      );
      // De-duplicate by template id while remembering which tag triggered each.
      const seen = new Set<string>();
      for (const rule of matchedRules) {
        if (seen.has(rule.formTemplateId)) continue;
        seen.add(rule.formTemplateId);

        if (existing.has(rule.formTemplateId)) {
          detail.pickupFormsAssigned.push({
            tag: rule.tag,
            formTemplateId: rule.formTemplateId,
            status: "existing",
          });
          formsAlreadyPresent++;
          continue;
        }

        const ok = await createFormSubmission({
          stopId: detail.stopId,
          templateId: rule.formTemplateId,
          title: `Specimen Pickup - ${detail.name}`.slice(0, TITLE_MAX),
          isRequired: true,
        });
        if (ok) {
          detail.pickupFormsAssigned.push({
            tag: rule.tag,
            formTemplateId: rule.formTemplateId,
            status: "created",
          });
          existing.add(rule.formTemplateId);
          pickupFormsCreated++;
        } else {
          detail.pickupFormsAssigned.push({
            tag: rule.tag,
            formTemplateId: rule.formTemplateId,
            status: "error",
          });
        }
        await sleep(interRequestDelayMs);
      }
    }

    // 4c. Delivery form: end stop, or any non-start stop tagged as depot.
    const deliveryRequired =
      position === "end" || (position !== "start" && detail.isDepot);

    if (!deliveryRequired) {
      detail.deliveryFormStatus = "notRequired";
    } else if (existing.has(deliveryFormTemplateId)) {
      detail.deliveryFormStatus = "existing";
      formsAlreadyPresent++;
    } else {
      const ok = await createFormSubmission({
        stopId: detail.stopId,
        templateId: deliveryFormTemplateId,
        title: `Specimen Delivery - ${detail.name}`.slice(0, TITLE_MAX),
        isRequired: true,
      });
      if (ok) {
        detail.deliveryFormStatus = "created";
        existing.add(deliveryFormTemplateId);
        deliveryFormsCreated++;
      } else {
        detail.deliveryFormStatus = "error";
      }
      await sleep(interRequestDelayMs);
    }

    existingFormsByStop.set(detail.stopId, existing);
    stopDetails.push(detail);
  }

  // 5. Patch the route once with the modified stop notes.
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
      notesUpdated,
      pickupFormsCreated,
      deliveryFormsCreated,
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
        `Failed to create form (template ${args.templateId}) for stop ${args.stopId}: ${describe(e)}`
      );
      return false;
    }
  }
}

// -- module-scope helpers --

function buildDetail(stop: any, position: StopDetail["position"]): StopDetail {
  return {
    stopId: idOf(stop),
    name: stop?.name ?? "",
    position,
    addressId: idOf(stop?.address) || null,
    matchedAddressName: stop?.address?.name ?? null,
    tags: [],
    isDepot: false,
    notesUpdated: false,
    pickupFormsAssigned: [],
    deliveryFormStatus: "notAttempted",
    skipReason: null,
  };
}

function addressMatchesTag(address: any, tag: string): boolean {
  const target = String(tag ?? "").trim();
  if (!target) return false;
  const targetLower = target.toLowerCase();
  const tags: any[] = Array.isArray(address?.tags) ? address.tags : [];
  return tags.some((t) => {
    const id = t?.id ? String(t.id) : "";
    const name = t?.name ? String(t.name).trim().toLowerCase() : "";
    return id === target || (name !== "" && name === targetLower);
  });
}

function addressMatchesAnyTag(address: any, tags: string[]): boolean {
  return tags.some((t) => addressMatchesTag(address, t));
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
  for (const stopChunk of chunk(stopIds, 50)) {
    for (const templateChunk of chunk(templateIds, 50)) {
      let cursor = "";
      let hasNext = true;
      while (hasNext) {
        const params = new URLSearchParams({
          startTime,
          assignedToRouteStopIds: stopChunk.join(","),
          formTemplateIds: templateChunk.join(","),
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

function idOf(obj: any): string {
  return obj?.id ? String(obj.id) : "";
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
