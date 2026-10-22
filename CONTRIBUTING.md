# Contributing to bugreport

Thanks for helping! This page covers how to get the code running, what a
change has to pass and how to send it.

## Before you start

- For anything larger than a bug fix, please open an issue first and describe
  what you want to change and why. It saves you work that might not fit.
- The library deliberately ships **no** storage, LLM or ticket-system
  implementation — those are adapters the host app provides. Provider-specific
  code belongs in `examples/`, not in `packages/`.
- No telemetry, no network calls besides the configured endpoint, no secrets
  in the library. Changes that weaken this will not be merged.

## Setup

Requirements: [Bun](https://bun.sh) ≥ 1.1 (Node 18+ works for consumers).

```bash
git clone https://github.com/symbiosika/bugreport.git
cd bugreport
bun install
bun run build
```

## Repository layout

| Path | What lives there |
|---|---|
| `packages/core` | Shared types and valibot schemas — the API contract |
| `packages/client` | Browser SDK: overlay, capture, context collection, upload |
| `packages/vue` | Thin Vue 3 wrapper |
| `packages/server` | Request handler, pipeline, adapter interfaces |
| `examples/hono-reference` | Runnable example with fs storage, AI SDK LLM adapter and a ZIP action |
| `docs/INTEGRATION.md` | Full reference for integrators |

## Checks

Every pull request must pass what CI runs:

```bash
bun run build
bun run typecheck
bun test packages
```

Optional, when you touch the respective parts:

```bash
# end-to-end in Chromium (uses the pre-built packages)
bun test examples/hono-reference/test/e2e.browser.test.ts

# real provider APIs — needs OPENROUTER_API_KEY and MISTRAL_API_KEY
bun run test:integration
```

## Guidelines

- TypeScript, ESM, no new runtime dependencies in `packages/*` without a good
  reason (the client currently depends only on `-core`, `-core` only on
  `valibot`).
- A change to the `BugReport` contract goes into `packages/core` first and
  must be reflected in `docs/INTEGRATION.md`.
- User-facing strings in the client exist in both locales (`en`, `de`) in
  `packages/client/src/i18n.ts`.
- Add or update tests for new behaviour in the server pipeline and schemas.
- Code, comments, docs and commit messages are in English.

## Sending a change

1. Fork the repository and create a branch from `main`.
2. Make your change, including tests and docs.
3. Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) if
   the change is visible to users of the packages.
4. Open a pull request and describe what changed and why.

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE) of this project, and that you follow our
[Code of Conduct](CODE_OF_CONDUCT.md).
