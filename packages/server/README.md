# @symbiosika/bugreport-server

Orchestrator für das Bug-Reporting: Web-Standard-Handler (`Request` →
`Response`, läuft auf Bun, Node 18+, Hono, Deno, Workers), Validierung,
Rate-Limit, Frame-Auswahl-Heuristik und die Verarbeitungs-Pipeline
(Transkription → Bildauswahl → Analyse → Speichern → Actions).

Drei Interfaces, null Implementierungen — Storage, LLM und Zielsystem stellt
die Host-App:

```ts
import { createBugReportHandler } from '@symbiosika/bugreport-server'

const handler = createBugReportHandler({
  storage: myStorage,        // StorageAdapter (Pflicht)
  llm: myLlm,                // LlmAdapter (optional)
  actions: [myAction],       // BugReportAction[] (mind. eine)
  auth: async (req) => verifySessionToken(req),
  limits: { maxAssetBytes: 10 * 1024 * 1024, maxImagesToLlm: 6, ratePerUserPerHour: 5 },
  consent: { version: '1.0', text: '…' },
})

app.all('/api/bugreport/*', (c) => handler(c.req.raw))
```

Fällt Transkription oder Analyse aus, entsteht der Report trotzdem
(`analysisStatus: 'failed' | 'skipped'`) — ein Bug-Report darf nie verloren
gehen, nur weil ein Fremdsystem nicht antwortet.

`buildAnalysisPrompt(input)` liegt als optionale, reine Prompt-Vorlage bei
(kein Adapter, kein Netzwerkzugriff).

Eine vollständige Referenz-Implementierung aller drei Adapter (Filesystem,
Vercel AI SDK, ZIP-Action) liegt im
[Monorepo unter `examples/hono-reference`](https://github.com/symbiosika/bugreport).
