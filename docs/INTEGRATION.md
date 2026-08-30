# Integration Guide

Everything you need to embed `@symbiosika/bugreport` into your app: client
configuration, server options, the three adapter interfaces, the HTTP
contract, and the data model. For a runnable end-to-end setup see
[`examples/hono-reference`](../examples/hono-reference).

- [1. How a report happens](#1-how-a-report-happens)
- [2. Client (`@symbiosika/bugreport-client`)](#2-client)
- [3. Vue wrapper (`@symbiosika/bugreport-vue`)](#3-vue-wrapper)
- [4. Server (`@symbiosika/bugreport-server`)](#4-server)
- [5. The three adapter interfaces](#5-the-three-adapter-interfaces)
- [6. HTTP API contract](#6-http-api-contract)
- [7. The `BugReport` data model](#7-the-bugreport-data-model)
- [8. Processing pipeline](#8-processing-pipeline)
- [9. Browser behavior and caveats](#9-browser-behavior-and-caveats)
- [10. Privacy checklist](#10-privacy-checklist)

## 1. How a report happens

1. The user clicks "Report a bug" (your button or the built-in floating one).
2. A **consent dialog** explains what will be recorded. The text comes from
   your server (`GET /config`), so it is a backend decision. No consent, no
   recording.
3. The browser's share picker opens (tab / window / screen) plus the
   microphone permission prompt.
4. A recording toolbar appears: **⏺ 00:14 · 📸 Screenshot · ⏸ Pause ·
   ✓ Submit · ✕ Cancel**. While recording, the client samples screen frames
   (periodically, on every click, and on manual screenshots) and records the
   microphone. Frames are uploaded as they are captured.
5. On submit the user can add an optional comment; audio uploads and the
   report is finalized. The server answers immediately (`202`) — transcription
   and analysis run asynchronously.
6. Your actions run on the finished report; `GET /:id` lets the client poll
   for the outcome (e.g. a ticket URL).

## 2. Client

```bash
bun add @symbiosika/bugreport-client
```

```ts
import { initBugReport } from '@symbiosika/bugreport-client'
const bugReport = initBugReport(config)
```

### Config reference

| Option | Type / default | Notes |
|---|---|---|
| `endpoint` | `string` — **required** | Base URL of the mounted server handler, e.g. `'/api/bugreport'` |
| `app` | `{ id, version?, environment? }` — **required** | Identifies your app in every report |
| `getAuthHeaders` | `() => headers` | Called before every request; return e.g. `{ Authorization: 'Bearer …' }` |
| `reporter` | `() => { id?, name?, email?, role? }` | Attached to the report |
| `capture.recordVideo` | `false` | Additionally record a real video (attachment only, not analyzed) |
| `capture.frameIntervalMs` | `4000` | Periodic frame sampling interval |
| `capture.microphone` | `true` | Record a voice note (separate opus recorder — clean input for transcription) |
| `capture.console.maxEntries` | `50` | Ring buffer size for console/error entries |
| `capture.network` | `true` | Wrap `fetch`/XHR to log **failed** requests (method, URL, status, duration — never bodies) |
| `capture.maxDurationMs` | `180000` | Hard stop; the submit dialog opens automatically |
| `capture.jpegQuality` | `0.7` | JPEG quality of sampled frames |
| `capture.maxFrameWidth` | `1600` | Frames are downscaled to at most this width |
| `redact.selectors` | `[]` | Elements covered with black bars before every frame grab (tab capture only — see §9) |
| `redact.urlParams` | `[]` | Query params replaced with `REDACTED` in every collected URL |
| `context` | `() => Record<string, unknown>` | Arbitrary app state, evaluated at submit time, lands in `context.custom` |
| `locale` | browser language | UI language, `'de'` or `'en'` |
| `requireTabCapture` | `false` | Chrome: steer the picker to the current tab (`preferCurrentTab`); the consent dialog also shows a "share only this tab" hint |
| `floatingButton` | `false` | Render the built-in floating button |
| `onSubmitted` | `({ reportId }) => void` | Show a toast, start polling `GET /:id`, … |
| `onError` | `(err) => void` | Permission denied, upload failure, … |

### Returned client

```ts
interface BugReportClient {
  isSupported: boolean          // false → render your own fallback, never the button
  unsupportedReason?: string
  state: 'idle' | 'consent' | 'recording' | 'paused' | 'submitting' | 'submitted' | 'error'
  start(): void                 // opens the consent dialog
  cancel(): void
  onStateChange(fn): () => void // returns unsubscribe
  destroy(): void               // removes overlay + console/network wrappers
}
```

`isSupported` is `false` on mobile devices, insecure contexts (no HTTPS) and
browsers without `getDisplayMedia`/`MediaRecorder`. A visible button that
fails on click is worse than no button — check it before rendering.

### What is collected automatically

From `initBugReport()` on, ring buffers record (transmitted **only** when the
user actually submits a report):

- `window.onerror`, `unhandledrejection`, `console.error` / `console.warn`
- failed `fetch`/XHR requests: method, URL, status, duration — **no bodies**
- click and navigation breadcrumbs (CSS selector / route, timestamp)
- at submit time: URL, viewport, `devicePixelRatio`, user agent, locale,
  timezone, and your `context()` result

## 3. Vue wrapper

```bash
bun add @symbiosika/bugreport-vue
```

```vue
<script setup lang="ts">
import { BugReportButton, useBugReport } from '@symbiosika/bugreport-vue'
const config = { endpoint: '/api/bugreport', app: { id: 'my-app' } }

// component: renders nothing on unsupported platforms
// composable: full control
const { start, isSupported, state } = useBugReport(config)
</script>

<template>
  <BugReportButton :config="config">Report a bug</BugReportButton>
</template>
```

The wrapper creates the client once and destroys it with the component.

## 4. Server

```bash
bun add @symbiosika/bugreport-server
```

```ts
import { createBugReportHandler } from '@symbiosika/bugreport-server'
const handler = createBugReportHandler(options)
```

The handler is a plain `(req: Request) => Promise<Response>` and matches
routes by suffix, so the mount prefix is up to you:

```ts
// Hono
app.all('/api/bugreport/*', (c) => handler(c.req.raw))
// Bun.serve
Bun.serve({ fetch: (req) => new URL(req.url).pathname.startsWith('/api/bugreport')
  ? handler(req) : app.fetch(req) })
```

### Options reference

| Option | Type / default | Notes |
|---|---|---|
| `storage` | `StorageAdapter` — **required** | Your persistence |
| `llm` | `LlmAdapter` | Omit to run without analysis (`analysisStatus: 'skipped'`) |
| `actions` | `BugReportAction[]` — **required** | At least one; run sequentially, fault-tolerant |
| `auth` | `(req) => AuthContext \| null` | `null` ⇒ `401`. `AuthContext.userId` keys the rate limit. Default: everyone is `"anonymous"` — set this in production |
| `consent` | `{ version, text }` — **required** | Served via `GET /config`; submits are rejected (`409`) if the client accepted a different version/text |
| `limits.maxAssetBytes` | `10 MiB` | Per uploaded asset |
| `limits.maxAssetsPerReport` | `40` | |
| `limits.maxImagesToLlm` | `6` | Cap for the frame-selection heuristic |
| `limits.ratePerUserPerHour` | `5` | Sliding window, in-memory (per process — put a shared limiter in `auth` if you run multiple instances) |
| `limits.maxDurationMs` | `180000` | Advertised to the client via `GET /config` |
| `statusEndpoint` | `true` | Set `false` to disable `GET /:id` |
| `logger` | console | `{ debug, info, warn, error }` |
| `onReportProcessed` | `(report) => void` | Fires when the async pipeline settles — useful in tests |

The returned handler also exposes `waitForPipelines(): Promise<void>` for
graceful shutdown and tests.

## 5. The three adapter interfaces

The module deliberately ships **no** storage, **no** LLM binding and **no**
target system — each installation decides provider, location, retention and
data protection itself, and the module stays free of dependencies and
secrets.

```ts
interface StorageAdapter {
  putAsset(reportId: string, asset: Omit<AssetMeta, 'key' | 'usedInAnalysis'>,
           data: ReadableStream<Uint8Array>): Promise<{ key: string }>
  getAsset(key: string): Promise<ReadableStream<Uint8Array>>
  saveReport(report: BugReport): Promise<void>
  getReport(reportId: string): Promise<BugReport | null>
}
```

Assets carry only a `key` — how a key becomes a URL (signed, public, not at
all) is decided in your storage or action code. Retention is yours too: the
module promises no TTL it could not enforce on your storage anyway.

```ts
interface LlmAdapter {
  transcribe(audio: Blob, opts: { language?: string }): Promise<{ text: string; language: string }>
  analyze(input: AnalysisInput): Promise<BugReportAnalysis>
}
```

`analyze` receives a curated `AnalysisInput` (transcript, selected images as
bytes, context) and must return a `BugReportAnalysis` — validated against the
valibot schema after the call. Which provider/model/prompt you use is your
business. So you don't have to redo the prompt work,
`buildAnalysisPrompt(input)` is exported as an **optional** template — a pure
string builder, no adapter, no network. The reference adapter in
`examples/hono-reference/src/adapters/ai-sdk-llm.ts` shows both wired to the
Vercel AI SDK.

```ts
interface BugReportAction {
  name: string
  run(report: BugReport, ctx: { logger: Logger; storage: StorageAdapter })
    : Promise<{ system: string; externalId?: string; externalUrl?: string } | void>
}
```

Actions run sequentially after the report is saved. A throwing action is
logged into `actionResults` and the remaining actions still run. Typical
actions: create a ticket (Jira/Gitea/Linear), POST to an n8n webhook, write a
ZIP to disk (see the example).

## 6. HTTP API contract

All bodies are valibot-validated (schemas in `@symbiosika/bugreport-core`).

| Method | Path (relative to mount) | Purpose | Response |
|---|---|---|---|
| `GET` | `/config` | Limits, consent text, `enabled` — no auth required | `200 BugReportPublicConfig` |
| `POST` | `/session` | Open a report (auth + rate limit) | `201 { reportId }` |
| `PUT` | `/:id/asset` | Multipart upload: fields `kind`, `capturedAt`, `caption?`, `file` | `201 { key }` |
| `POST` | `/:id/submit` | Context + consent; kicks off the async pipeline | `202 { reportId }` |
| `GET` | `/:id` | Poll status/result (optional, can be disabled) | `200 { id, status, analysisStatus, title?, actionResults, externalUrl? }` |

Error codes: `400` invalid body, `401` auth returned null, `404` unknown
report, `409` already submitted / consent mismatch, `413` asset too large or
too many, `429` rate limit.

Assets are uploaded individually as they are captured — that spreads load,
shows real progress and survives connection drops better than one big upload
at the end.

## 7. The `BugReport` data model

The normalized record is the contract between pipeline and actions — see
[`packages/core/src/types.ts`](../packages/core/src/types.ts) for the exact
shape. Highlights:

- `title`, `summary`, `stepsToReproduce`, `severitySuggestion`, `labels`,
  `confidence` come from **your** `LlmAdapter` and are empty when
  `analysisStatus` is `'skipped'` or `'failed'`.
- `context` carries console entries, network errors, breadcrumbs, viewport,
  UA, locale, timezone and your custom app state.
- `assets[*].usedInAnalysis` tells you which images went to the LLM.
- `consent` records when the user accepted which consent text (version +
  hash).
- `actionResults` collects the outcome of every action (ticket id/URL or
  error) — this is what `GET /:id` surfaces to the client.

## 8. Processing pipeline

On submit the server responds `202` immediately, then asynchronously:

1. **Transcription** via your adapter (if configured) — the audio asset is a
   clean mono opus/webm file from a dedicated recorder.
2. **Image selection** (always runs, provider-independent). Priority:
   (a) manual screenshots, (b) frames from time windows where the transcript
   contains pointing words ("here", "now", "error", "crash", …),
   (c) first and last frame — capped at `maxImagesToLlm`.
3. **Analysis** via your adapter; the result is schema-validated.
4. **Save** via `storage.saveReport`.
5. **Actions**, sequential and fault-tolerant.

If step 1 or 3 fails, the report is still assembled and saved with
`analysisStatus: 'failed'`, and actions still run — a bug report must never
be lost because a third-party system didn't answer.

## 9. Browser behavior and caveats

| Topic | Behavior |
|---|---|
| Supported platforms | Chrome, Edge, Firefox, Safari on desktop. Mobile is not supported (`getDisplayMedia` unavailable on iOS Safari entirely); `isSupported` reports `false` |
| Secure context | Required (HTTPS or localhost) — hard check at init |
| User gesture | The consent dialog's accept button is the gesture; `getDisplayMedia` is called synchronously from it (no awaits before) |
| Recording toolbar in captures | Never in sampled frames/screenshots: the overlay is hidden before each grab and the client waits for **fresh frames from the capture stream** (via `requestVideoFrameCallback`, with a timing fallback) before drawing — waiting for page repaints alone would not be enough at ~10 fps capture. With `recordVideo: true` the toolbar **is** visible in the attached video, which records continuously |
| Redaction | `redact.selectors` overlays matching elements with black bars before each grab. Works only when the user shares the **current tab**; for window/screen sharing the client cannot mask anything — warn in your consent text or set `requireTabCapture: true` |
| Accidentally sharing other windows | With `requireTabCapture: true` Chrome pre-selects the current tab (`preferCurrentTab`); the consent dialog recommends "share only this tab" |
| Stop sharing via browser UI | Treated like pressing Submit — the comment dialog opens |
| Safari | No `ImageCapture.grabFrame()`; the `<video>` → canvas path is used everywhere |

## 10. Privacy checklist

- [ ] Write a consent text that names what is captured (screen stills of the
      shared surface, microphone, console/network metadata) and who processes
      it. Version it — the server rejects submits against outdated consent.
- [ ] Configure `redact.selectors` for known-sensitive elements and
      `redact.urlParams` for tokens/signatures.
- [ ] Consider `requireTabCapture: true` for apps with sensitive data.
- [ ] Decide retention in your `StorageAdapter`'s backing store and delete on
      schedule — the module intentionally has no persistence of its own.
- [ ] If you use an LLM: your `LlmAdapter` decides the provider and region;
      run without `llm` if AI processing is not cleared for your installation.
- [ ] Implement `auth` — the default accepts everyone as `anonymous`.
