# @symbiosika/bugreport-server

The orchestrator for bug reporting: a web-standard handler (`Request` →
`Response` — runs on Bun, Node 18+, Hono, Deno, Workers), validation, rate
limiting, the frame-selection heuristic and the processing pipeline
(transcription → image selection → analysis → save → actions).

Three interfaces, zero implementations — storage, LLM and target system are
provided by the host app:

```ts
import { createBugReportHandler } from '@symbiosika/bugreport-server'

const handler = createBugReportHandler({
  storage: myStorage,        // StorageAdapter (required)
  llm: myLlm,                // LlmAdapter (optional)
  actions: [myAction],       // BugReportAction[] (at least one)
  auth: async (req) => verifySessionToken(req),
  limits: { maxAssetBytes: 10 * 1024 * 1024, maxImagesToLlm: 6, ratePerUserPerHour: 5 },
  consent: { version: '1.0', text: '…' },
})

app.all('/api/bugreport/*', (c) => handler(c.req.raw))
```

If transcription or analysis fails, the report is still created
(`analysisStatus: 'failed' | 'skipped'`) — a bug report must never be lost
because a third-party system didn't answer.

`buildAnalysisPrompt(input)` ships as an optional, pure prompt template (no
adapter, no network access).

A complete reference implementation of all three adapters (filesystem,
Vercel AI SDK, ZIP action) lives in the
[monorepo under `examples/hono-reference`](https://github.com/symbiosika/bugreport);
all options are documented in the
[integration guide](https://github.com/symbiosika/bugreport/blob/main/docs/INTEGRATION.md).
