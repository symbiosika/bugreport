# @symbiosika/bugreport

In-app bug reporting for TypeScript apps: your users **show and tell** what
went wrong instead of typing it. The client records screen stills and a voice
note, collects technical context (console errors, failed requests,
breadcrumbs), and your backend turns it into a normalized, optionally
LLM-analyzed `BugReport` that you store and route wherever you want.

**You bring three adapters** (storage, LLM, target system) — the packages
bring everything else: overlay UI, capture, upload protocol, validation, and
the processing pipeline. No vendor lock-in, no secrets in the library, no
built-in telemetry.

```
Browser                                Your backend
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ your app                    │        │ your server (Hono/Bun/Node/…)    │
│  └ @symbiosika/bugreport-   │ HTTPS  │  └ @symbiosika/bugreport-server  │
│     client                  │ ─────▶ │     validation · rate limit ·    │
│     overlay · capture ·     │        │     pipeline → BugReport         │
│     context · upload        │        │        │                         │
└─────────────────────────────┘        │        ├─▶ StorageAdapter ← you  │
                                       │        ├─▶ LlmAdapter     ← you  │
                                       │        └─▶ actions[]      ← you  │
                                       └──────────────────────────────────┘
```

## Packages

| Package | What you get |
|---|---|
| `@symbiosika/bugreport-client` | Browser SDK (vanilla TS, framework-agnostic): consent dialog, recording overlay (Shadow DOM), screen frame sampling, mic recording, context collection, upload |
| `@symbiosika/bugreport-server` | Web-standard `Request → Response` handler + processing pipeline + the three adapter interfaces |
| `@symbiosika/bugreport-vue` | Optional Vue 3 wrapper: `<BugReportButton />` + `useBugReport()` |
| `@symbiosika/bugreport-core` | Shared types and valibot schemas (pulled in automatically) |

## Quickstart

### 1. Backend — mount the handler, implement the adapters

```bash
bun add @symbiosika/bugreport-server   # or npm/pnpm/yarn
```

```ts
import { createBugReportHandler } from '@symbiosika/bugreport-server'

const handler = createBugReportHandler({
  storage: myStorage,          // required — your persistence (S3, DB, fs, …)
  llm: myLlm,                  // optional — without it: analysisStatus 'skipped'
  actions: [myTicketAction],   // required — at least one; receives the finished report

  auth: async (req) => {
    const user = await verifySessionToken(req)
    return user ? { userId: user.id } : null   // null ⇒ 401
  },

  limits: {
    maxAssetBytes: 10 * 1024 * 1024,
    maxAssetsPerReport: 40,
    maxImagesToLlm: 6,
    ratePerUserPerHour: 5,
  },

  consent: { version: '1.0', text: 'We will record screen stills of this tab …' },
})

// The handler is plain (Request) => Promise<Response> and prefix-agnostic —
// mount it under any path on Hono, Bun.serve, Deno, Cloudflare Workers, …
app.all('/api/bugreport/*', (c) => handler(c.req.raw))
```

The three interfaces you implement (a few dozen lines each — see the
[reference example](examples/hono-reference)):

```ts
interface StorageAdapter {
  putAsset(reportId, asset, data: ReadableStream): Promise<{ key: string }>
  getAsset(key): Promise<ReadableStream>
  saveReport(report: BugReport): Promise<void>
  getReport(reportId): Promise<BugReport | null>
}

interface LlmAdapter {   // optional — pick any provider, model, prompt, on-prem …
  transcribe(audio: Blob, opts: { language? }): Promise<{ text; language }>
  analyze(input: AnalysisInput): Promise<BugReportAnalysis>
}

interface BugReportAction {   // Jira, Gitea, n8n webhook, ZIP on disk, …
  name: string
  run(report: BugReport, ctx: { logger, storage }): Promise<ActionResult | void>
}
```

### 2. Frontend — one config point

```bash
bun add @symbiosika/bugreport-client
```

```ts
import { initBugReport } from '@symbiosika/bugreport-client'

const bugReport = initBugReport({
  endpoint: '/api/bugreport',
  app: { id: 'operations-app', version: __APP_VERSION__, environment: 'prod' },

  getAuthHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  reporter: () => ({ id: user.id, name: user.name, email: user.email }),

  redact: {
    selectors: ['[data-private]', 'input[type=password]'],  // blacked out in frames
    urlParams: ['token', 'sig'],                             // stripped from URLs
  },

  context: () => ({ route: router.currentRoute.value.fullPath }),
  locale: 'de',                                              // 'de' | 'en'
  onSubmitted: ({ reportId }) => toast(`Report ${reportId} submitted`),
})

// Desktop browsers only — offer your own fallback (e.g. a plain form) otherwise.
if (bugReport.isSupported) {
  myButton.addEventListener('click', () => bugReport.start())
}
```

Or with Vue:

```vue
<script setup>
import { BugReportButton } from '@symbiosika/bugreport-vue'
</script>
<template>
  <!-- renders nothing on unsupported platforms -->
  <BugReportButton :config="bugReportConfig" />
</template>
```

### 3. What your action receives

Every action gets the normalized `BugReport` — the stable contract:

```ts
{
  id, createdAt, status: 'done',
  app: { id, version, environment },
  reporter: { id, name, email },

  // from your LlmAdapter (empty when analysis is skipped or failed):
  title, summary, stepsToReproduce, expectedBehaviour, actualBehaviour,
  severitySuggestion: 'low' | 'medium' | 'high' | 'critical',
  labels, confidence,

  transcript: { text, language },
  userComment,
  context: { url, route, viewport, userAgent, locale, timezone,
             consoleEntries, networkErrors, breadcrumbs, custom },
  assets: [{ key, kind: 'screenshot' | 'frame' | 'video' | 'audio',
             mimeType, bytes, capturedAt, usedInAnalysis }],
  consent: { acceptedAt, version, textHash },
  analysisStatus: 'ok' | 'skipped' | 'failed',
  actionResults: [{ system, externalId?, externalUrl? }],
}
```

Reports never get lost: if transcription or analysis fails, the report is
still saved and your actions still run (`analysisStatus: 'failed'`). Running
without any LLM at all is a regular mode, not a degraded one.

## Good to know

- **Desktop browsers only** (Chrome, Edge, Firefox, Safari). Mobile cannot use
  `getDisplayMedia`; `isSupported` reports `false` there so you can offer an
  alternative. Requires a secure context (HTTPS or localhost).
- **Frame sampling instead of video**: by default the screen stream is sampled
  into JPEG stills (every 4 s, on clicks, and on manual screenshots) — small,
  LLM-ready, no ffmpeg. Set `capture.recordVideo: true` to additionally attach
  a real video (for timing/animation bugs).
- **The recording toolbar never appears in captured frames** — it is hidden
  before every grab and the client waits for fresh frames from the capture
  stream before drawing. With `recordVideo: true` the toolbar is visible in
  the attached video (it records continuously).
- **Redaction** (`redact.selectors`) covers elements with black bars before
  each grab. This only works when the user shares the *current tab* — for
  window/full-screen sharing the client cannot mask anything. Set
  `requireTabCapture: true` for sensitive apps.
- **Retention is yours**: the module stores nothing itself; whatever your
  `StorageAdapter` writes, you delete on your own schedule.

Full reference (all options, API contract, pipeline details):
**[docs/INTEGRATION.md](docs/INTEGRATION.md)**

## Reference example

[`examples/hono-reference`](examples/hono-reference) is a complete, runnable
implementation of all three adapters — filesystem storage, an `LlmAdapter`
built on the Vercel AI SDK (OpenRouter vision model + Mistral Voxtral
transcription), and an action that zips the finished report to disk. It is a
copy template, not a published package.

```bash
bun install && bun run build
cd examples/hono-reference
OPENROUTER_API_KEY=… MISTRAL_API_KEY=… bun run dev   # → http://localhost:3000
```

## Development

```bash
bun install
bun run build        # all packages (ESM bundles + .d.ts)
bun run typecheck
bun test packages                                          # unit tests
bun run test:integration                                   # real LLM APIs (needs keys)
bun test examples/hono-reference/test/e2e.browser.test.ts  # Chromium e2e
```

CI (`.github/workflows/ci.yml`) builds, typechecks, tests and does a pack
dry-run. Each package under `packages/*` has a `prepack` build — publish with
`cd packages/<name> && npm publish --access public`.

## License

MIT
