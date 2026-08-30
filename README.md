# @symbiosika/bugreport

Universelles In-App Bug-Reporting: Endanwender melden Fehler **zeigend und
sprechend** statt tippend. Aus Bildschirm-Standbildern, Mikrofon-Aufnahme und
technischem Kontext (Konsole, Netzwerk, Breadcrumbs) entsteht ein normierter,
LLM-analysierter Datensatz, den die Host-App über selbst implementierte
Adapter speichert und weiterleitet.

## Pakete

| Paket | Inhalt |
|---|---|
| [`@symbiosika/bugreport-core`](packages/core) | Typen, Valibot-Schemas, API-Contract — die einzige gemeinsame Abhängigkeit von Client und Server |
| [`@symbiosika/bugreport-client`](packages/client) | Browser-SDK (Vanilla TS): Overlay-UI (Shadow DOM), Frame-Sampling, Audio-Aufnahme, Kontext-Collector, Upload |
| [`@symbiosika/bugreport-vue`](packages/vue) | Dünner Vue-3-Wrapper: `<BugReportButton />` + `useBugReport()` |
| [`@symbiosika/bugreport-server`](packages/server) | Web-Standard-Handler (`Request` → `Response`), Pipeline, die drei Host-Interfaces, `buildAnalysisPrompt` |

`examples/hono-reference/` ist die vollständige, lauffähige Kopiervorlage —
sie wird **nicht** veröffentlicht.

## Architekturprinzip: drei Interfaces, null Implementierungen

Das Modul liefert **keine** LLM-Anbindung, **keinen** Storage und **kein**
Zielsystem. Die Host-App implementiert drei Interfaces und entscheidet damit
selbst über Anbieter, Speicherort, Löschfristen und Datenschutz:

```ts
import { createBugReportHandler } from '@symbiosika/bugreport-server'

const handler = createBugReportHandler({
  storage: myStorage,        // Pflicht  — StorageAdapter
  llm: myLlm,                // optional — ohne: analysisStatus 'skipped'
  actions: [myAction],       // Pflicht  — mindestens eine BugReportAction
  auth: async (req) => verifySessionToken(req),   // null ⇒ 401
  consent: { version: '1.0', text: '…' },
})

// Hono, Bun.serve, Deno, Workers — alles mit Web-Standard Request/Response:
app.all('/api/bugreport/*', (c) => handler(c.req.raw))
```

Frontend — ein Konfig-Punkt:

```ts
import { initBugReport } from '@symbiosika/bugreport-client'

const bugReport = initBugReport({
  endpoint: '/api/bugreport',
  app: { id: 'operations-app', version: __APP_VERSION__, environment: 'prod' },
  redact: { selectors: ['[data-private]'], urlParams: ['token'] },
  locale: 'de',
})

if (bugReport.isSupported) bugReport.start() // sonst eigene Alternative anbieten
```

## Beispiel starten

```bash
bun install
bun run build
cd examples/hono-reference

OPENROUTER_API_KEY=… MISTRAL_API_KEY=… bun run dev
# → http://localhost:3000  (fertige Reports landen als ZIP in ./bugreports/)
```

Ohne API-Keys läuft alles trotzdem — Reports entstehen dann mit
`analysisStatus: 'skipped'` (regulärer Betriebsmodus für Installationen ohne
KI-Freigabe).

## Entwicklung

```bash
bun install
bun run build        # alle Pakete (ESM-Bundle + .d.ts)
bun run typecheck    # tsc über alle Pakete + Beispiel
bun test packages    # Unit-Tests (Schemas, Frame-Auswahl, Handler/Pipeline)

# gegen die echten Provider-APIs (OPENROUTER_API_KEY + MISTRAL_API_KEY nötig):
bun run test:integration

# Browser-E2E (Chromium mit Fake-Media-Devices, klickt das Overlay durch):
bun test examples/hono-reference/test/e2e.browser.test.ts
```

Veröffentlichen: jedes Paket unter `packages/*` hat ein `prepack`-Build —
`cd packages/<x> && npm publish --access public` reicht. Die CI
(`.github/workflows/ci.yml`) baut, prüft Typen, testet und macht einen
Pack-Dry-Run.

## Zielplattform

Desktop-Browser (Chrome, Edge, Firefox, Safari). Mobile wird bewusst nicht
unterstützt (`getDisplayMedia` fehlt dort) — `isSupported` meldet `false`,
der Button erscheint gar nicht erst.

Das vollständige Konzept steht in [`docs/KONZEPT.md`](docs/KONZEPT.md).
