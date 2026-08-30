# Hono reference example

Complete, runnable implementation of all three host interfaces — intended as
a copy template, never published as a package.

| Adapter | File | Implementation |
|---|---|---|
| `StorageAdapter` | [`src/adapters/fs-storage.ts`](src/adapters/fs-storage.ts) | Filesystem (`data/`) — swap for S3/GCS/DB in production |
| `LlmAdapter` | [`src/adapters/ai-sdk-llm.ts`](src/adapters/ai-sdk-llm.ts) | **Vercel AI SDK**: `generateObject` against an OpenRouter vision model (analysis) + Mistral Voxtral (transcription) |
| `BugReportAction` | [`src/adapters/zip-action.ts`](src/adapters/zip-action.ts) | Bundles the report (JSON + Markdown) and all assets into a ZIP on the local disk (`bugreports/`) |

The LLM adapter is deliberately **not** part of the library: provider, model,
prompt and deployment are backend decisions of the host app. It uses the
optional `buildAnalysisPrompt` template exported by
`@symbiosika/bugreport-server`.

## Running it

```bash
# from the repo root:
bun install && bun run build

cd examples/hono-reference
OPENROUTER_API_KEY=… MISTRAL_API_KEY=… bun run dev
# → http://localhost:3000
```

The demo page contains intentional bugs (a JS exception, a failing request)
and an element blacked out via `redact.selectors`. Flow: floating button →
consent → share this tab → demonstrate the bug while talking → "Submit". The
finished result lands as a ZIP in `./bugreports/`.

Without API keys everything still works — reports are then created with
`analysisStatus: 'skipped'`.

### Environment variables

| Variable | Effect |
|---|---|
| `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` | Enable the LLM adapter; without them: `analysisStatus 'skipped'` |
| `OPENROUTER_MODEL` | Analysis model (default `google/gemini-2.5-flash`) |
| `PORT` | Default `3000` |
| `BUGREPORT_DATA_DIR` / `BUGREPORT_ZIP_DIR` | Override storage locations |
| `BUGREPORT_CURL_FETCH=1` | fetch-via-curl shim for sandboxes with a TLS-intercepting proxy (see `src/lib/curl-fetch.ts`) |

## Tests

```bash
# integration test against the real provider APIs:
bun test test/integration.test.ts

# browser e2e (Chromium + fake media devices, drives the real overlay):
bun test test/e2e.browser.test.ts
```
