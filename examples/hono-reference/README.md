# Hono-Referenzbeispiel

Vollständige, lauffähige Beispiel-Implementierung aller drei Host-Interfaces —
als Kopiervorlage gedacht, wird nicht als Paket veröffentlicht.

| Adapter | Datei | Implementierung |
|---|---|---|
| `StorageAdapter` | [`src/adapters/fs-storage.ts`](src/adapters/fs-storage.ts) | Dateisystem (`data/`) — in Produktion: S3/GCS/DB |
| `LlmAdapter` | [`src/adapters/ai-sdk-llm.ts`](src/adapters/ai-sdk-llm.ts) | **Vercel AI SDK**: `generateObject` gegen ein OpenRouter-Vision-Modell (Analyse) + Mistral Voxtral (Transkription) |
| `BugReportAction` | [`src/adapters/zip-action.ts`](src/adapters/zip-action.ts) | Packt Report (JSON + Markdown) und alle Assets als ZIP auf die lokale Platte (`bugreports/`) |

Der LLM-Adapter ist bewusst **nicht** Teil der Bibliothek: Anbieter, Modell,
Prompt und Deployment sind Backend-Entscheidungen der Host-App. Er nutzt die
optionale Prompt-Vorlage `buildAnalysisPrompt` aus
`@symbiosika/bugreport-server`.

## Starten

```bash
# im Repo-Root:
bun install && bun run build

cd examples/hono-reference
OPENROUTER_API_KEY=… MISTRAL_API_KEY=… bun run dev
# → http://localhost:3000
```

Die Demo-Seite enthält absichtliche Fehler (JS-Exception, kaputter Request)
und ein per `redact.selectors` geschwärztes Element. Ablauf: Floating-Button →
Einwilligung → Tab freigeben → Fehler vorführen und dabei sprechen →
„Übermitteln". Das fertige Ergebnis liegt danach als ZIP in `./bugreports/`.

### Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `OPENROUTER_API_KEY` / `MISTRAL_API_KEY` | Aktivieren den LLM-Adapter; ohne sie: `analysisStatus 'skipped'` |
| `OPENROUTER_MODEL` | Analyse-Modell (Default `google/gemini-2.5-flash`) |
| `PORT` | Default `3000` |
| `BUGREPORT_DATA_DIR` / `BUGREPORT_ZIP_DIR` | Ablageorte überschreiben |
| `BUGREPORT_CURL_FETCH=1` | fetch-über-curl-Shim für Sandboxes mit TLS-Intercepting-Proxy (siehe `src/lib/curl-fetch.ts`) |

## Tests

```bash
# Integrationstest gegen die echten Provider-APIs:
bun test test/integration.test.ts

# Browser-E2E (Chromium + Fake-Media-Devices, klickt das echte Overlay durch):
bun test test/e2e.browser.test.ts
```
