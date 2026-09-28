# Autofill v1 — Detect, confidence-scored fill, multi-step continuation

> **Status:** Greenhouse beta shipped (PR #5). **In progress:** `feature/autofill-universal-fill` — shared heuristic fill for non-Greenhouse ATS hosts. LinkedIn Easy Apply has no dedicated selector map; jobs pages use the same heuristic path (best-effort).  
> **Strategy B:** §4 · **Manual gate passed for Greenhouse fixtures;** live ATS retest still recommended before store release.

## Permission audit (universal-fill)

| Item | Current |
|------|---------|
| Autofill runner `content_scripts.matches` | Greenhouse, Lever, Ashby, Workday (`*.myworkdayjobs.com`), iCIMS, UKG, Jobright, LinkedIn `/jobs/*` (see `manifest.json`) |
| `host_permissions` includes `"https://*/*"` | Yes (JD capture); **do not widen further** |
| Universal-fill plan | Runner hosts expanded (Slice 4); fill uses shared `fill-engine` heuristics for unknown platforms — no new `host_permissions` |

## Goals

1. Map Smart Resume tailored resume fields → ATS application forms (Greenhouse via selector map; other supported hosts via shared heuristic fill).
2. Keep selectors **data-only** (`content/autofill/selectors.json`) so DOM churn does not require code deploys for mapped platforms.
3. Weekly regression CI against snapshot HTML fixtures (when fixtures exist).

## Architecture

### Fill paths

| Path | When | Behavior |
|------|------|----------|
| Greenhouse selector-map | `payload.platform === "greenhouse"` | `fillGreenhouse()` → `fillApplicationForm(..., { preferSelectorMap: "greenhouse" })` — map selectors take priority |
| Shared heuristic | Lever, Ashby, Workday, iCIMS, UKG, Jobright, LinkedIn jobs, `unknown` | `fillApplicationForm()` — resolve each field: selector map (if any) → payload selector → detector heuristic candidates |

### Resolution order (per field, in `fill-engine.ts`)

1. Platform selector map (`selectors.json`) when a map exists for the platform  
2. Payload-provided CSS selector  
3. Detector heuristic candidate (label/name/placeholder concepts)  
4. `not_found` — file inputs are never written (`not_applicable_file_upload`)

## Module layout

```
content/autofill/
  selectors.json      Host patterns + field maps (Greenhouse + LinkedIn scaffold)
  types.ts            AutofillPayload, FillResult, FieldFillOutcome
  fill-engine.ts      fillApplicationForm() — shared engine for all platforms
  fill-utils.ts       DOM write helpers (input/select/events)
  greenhouse.ts       fillGreenhouse() — thin wrapper preferring greenhouse map
  linkedin.ts         Reserved; LinkedIn jobs currently use shared heuristic path
  detector.ts         Application-form detection + field candidates
  continuation.ts     Multi-step form observation
  overlay.ts          In-page confidence overlay
  controller.ts       fillForPayload routing, PROBE_AUTOFILL, overlay host
  runner.ts           Content-script entry
src/autofillApi.ts    GET /api/job-descriptions/{id}/autofill-payload client
src/autofillFlags.ts  Kill switch + host helpers (isAutofillHost, …)
background/           FETCH_AUTOFILL_PAYLOAD message handler
popup/                "Autofill (beta)" enabled on autofill-runner hosts (flag-gated)
```

## Autofill runner hosts

Aligned with `manifest.json` `autofill-runner.js` matches:

- `https://*.greenhouse.io/*`
- `https://jobs.lever.co/*`, `https://*.lever.co/*`
- `https://jobs.ashbyhq.com/*`, `https://*.ashbyhq.com/*`
- `https://*.myworkdayjobs.com/*`
- `https://*.icims.com/*`
- `https://*.ukg.net/*`
- `https://jobright.ai/*`, `https://www.jobright.ai/*`
- LinkedIn jobs: `https://www.linkedin.com/jobs/*` (+ nested path variants) — **not** a dedicated Easy Apply implementation; heuristic fill only

Popup enablement uses `isAutofillHost(url)` so the button is available wherever the runner injects. `isAutofillEnabled()` (kill switch) still gates the feature.

## Selector maintenance policy

- One JSON entry per ATS target with a dedicated map; version field bumped on breaking selector changes.
- Never hardcode CSS classes in TypeScript for mapped platforms — only read from `selectors.json`.
- Unknown / unmapped hosts rely on detector heuristics, not hardcoded class lists.
- LinkedIn/Greenhouse class rotation (mapped fields): update JSON + fixture snapshot, run weekly workflow.
- Do **not** add broad `host_permissions` until a platform passes manual validation.

## API contract (Smart Resume)

```
GET /api/job-descriptions/{id}/autofill-payload
Authorization: Bearer {sr_jwt}
→ { jd_id, platform, fields: [{ key, selector, value, label? }] }
```

`platform` is `"greenhouse" | "linkedin" | "unknown"`. Non-Greenhouse hosts typically receive `"unknown"` and fill via heuristics.

## FillResult semantics

| Field | Meaning |
|-------|---------|
| `fields` | Per-field outcomes (`FieldFillOutcome[]`) |
| `fields[].status` | `filled_high_confidence` (map/payload match), `filled_needs_review` (heuristic), `not_found`, `not_applicable_file_upload` |
| `fields[].selector` | Selector used or attempted |
| `fields[].value_preview` | Truncated value written (when filled) |
| `percent_filled` | Share of applicable fields filled (high confidence or needs review) |

## Security

- No autofill without authenticated SR session.
- Payload values are user resume data only — never execute page scripts from payload.
- Content script injection limited to autofill-runner match hosts (see permission audit).

## Next steps

1. Live retest on Lever / Ashby / Workday / iCIMS application forms.
2. Capture HTML fixtures → expand Playwright e2e coverage beyond Greenhouse + generic.
3. Dedicated LinkedIn Easy Apply modal support remains a separate user gate if heuristics prove insufficient.
4. Keep popup + overlay copy host-agnostic as runner matches grow.
5. **Application profile (Flint Apply):** collect reusable answers (work authorization, visa sponsorship, earliest start date, salary expectations, veteran/disability EEO, “how did you hear about us”) during tailor/wizard and include them in `autofill-payload`. Greenhouse custom questions use dynamic `job_application[answers][id]` selectors — match by label text client-side.
6. **MyGreenhouse embed:** autofill-runner uses `all_frames: true`; top frame broadcasts fill to `job-boards.greenhouse.io` embed iframes via `postMessage`.
