# Konzept: Universelles In-App Bug-Reporting-Modul

**Arbeitstitel:** `@symbiosika/bugreport`
**Stand:** 30.08.2026 · Entwurf v3 (vereinfacht: keine mitgelieferten Adapter, Desktop-only)

---

## 1. Ziel

Ein wiederverwendbares Paket-Set, das in beliebige TypeScript-Apps eingebunden wird und Endanwendern erlaubt, einen Fehler **zeigend und sprechend** zu melden statt ihn zu tippen. Aus der Aufnahme entsteht ein strukturierter Datensatz, den die Host-App über selbst implementierte Adapter auswertet, speichert und weiterleitet.

### Was das Modul liefert

- Overlay-UI und Aufnahme im Browser
- Erfassung des technischen Kontexts (Konsole, Netzwerk, Route, Breadcrumbs)
- Upload-Protokoll und Server-Routing
- Orchestrierung der Verarbeitungskette
- **Den normierten Datensatz als Vertrag**

### Was das Modul bewusst nicht liefert

Keine LLM-Anbindung, kein Storage, kein Zielsystem. Für alle drei gibt es ein Interface — die Implementierung liegt bei der Host-App. Damit entscheidet jede Installation selbst über Anbieter, Speicherort, Löschfristen und Datenschutz, und das Modul bleibt frei von Abhängigkeiten und Secrets.

### Kernprinzipien

| Prinzip | Bedeutung |
|---|---|
| Framework-agnostisch | Client als Vanilla-TS; Vue-Wrapper als dünne Schicht obendrauf |
| Ein Konfig-Punkt im Frontend | Nur `endpoint` + App-Identität; der Rest hat Defaults |
| Normierter Datensatz als Vertrag | Alles zwischen Client, LLM-Adapter und Action ist typisiert |
| Drei Interfaces, null Implementierungen | Storage, LLM, Action werden vom Host gestellt |
| Zero Dependencies im Kern | Nur Valibot in `core` (tree-shakeable); Client und Server ohne Runtime-Deps |
| Desktop-Browser als Zielplattform | Chrome, Edge, Firefox, Safari Desktop |

---

## 2. Architektur

```
┌──────────────────────── Browser (Desktop) ───────────────┐
│  App (Vue/React/…)                                       │
│    └─ @symbiosika/bugreport-client                       │
│         · Overlay-UI (Shadow DOM)                        │
│         · getDisplayMedia  → Bildschirm-Stream           │
│         · getUserMedia     → Mikrofon                    │
│         · Frame-Sampling + manuelle Screenshots          │
│         · Kontext-Collector (Konsole, Netzwerk, Route)   │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTPS, definierte REST-API
┌───────────────────────────▼──────────────────────────────┐
│  Host-Backend                                            │
│    └─ @symbiosika/bugreport-server  (Orchestrator)       │
│         · Route-Handler, Validierung, Rate-Limit         │
│         · Frame-Auswahl-Heuristik                        │
│         · Pipeline → BugReport (normiert)                │
│                                                          │
│         ruft auf ─┬─ StorageAdapter  ← Host              │
│                   ├─ LlmAdapter      ← Host (optional)   │
│                   └─ actions[]       ← Host              │
└──────────────────────────────────────────────────────────┘
```

Die Wertschöpfung des Server-Pakets liegt in Ablauf, Validierung und Datenmodell, nicht in der Anbindung konkreter Dienste. Es ist ein Orchestrator, kein Integrations-Framework.

---

## 3. Repo- und Paketstruktur

Monorepo, Bun-Workspaces:

```
bugreport/
├─ packages/
│  ├─ core/     @symbiosika/bugreport-core     Typen, Valibot-Schemas, API-Contract
│  ├─ client/   @symbiosika/bugreport-client   Browser-SDK (Vanilla TS)
│  ├─ vue/      @symbiosika/bugreport-vue      <BugReportButton />, Composable
│  └─ server/   @symbiosika/bugreport-server   Handler + Pipeline + Interfaces
└─ examples/
   └─ hono-reference/    Vollständige Beispiel-Implementierung aller drei Adapter
```

`examples/` wird **nicht** als Paket veröffentlicht. Es ist eine Kopiervorlage. Das ist der bewusste Preis der Vereinfachung: Wer integriert, implementiert drei Interfaces selbst. Damit die Einstiegshürde niedrig bleibt, muss das Referenzbeispiel vollständig und lauffähig sein — mit S3-Storage, einem LLM-Adapter und einer Webhook-Action, alles in wenigen Dutzend Zeilen pro Adapter.

`core` ist die einzige gemeinsame Abhängigkeit von `client` und `server`. Ändert sich der Datensatz, brechen beide Seiten zur Compile-Zeit gleichzeitig.

---

## 4. Frontend-Modul

### 4.1 Ablauf aus Nutzersicht

1. Nutzer klickt „Fehler melden" (eigener Button oder eingebauter Floating-Button).
2. **Einwilligungsdialog**: erklärt, was aufgezeichnet wird, mit Bestätigung. Ohne Zustimmung kein Start. Text kommt vom Host über `/bugreport/config`.
3. Browser-Dialog zur Freigabe (Tab / Fenster / Bildschirm) + Mikrofon-Freigabe.
4. Overlay: **Aufnahme läuft ⏺ 00:14** · `📸 Screenshot` · `⏸ Pause` · `✓ Übermitteln` · `✕ Abbrechen`.
5. Nutzer spricht und klickt sich durch das Problem, drückt bei relevanten Stellen „Screenshot".
6. „Übermitteln" → optionales Freitextfeld → Upload mit Fortschrittsanzeige.
7. Bestätigung. Optional Nachreichung der Ticketnummer per Callback.

### 4.2 Frame-Sampling statt Video

Der Bildschirm-Stream wird geöffnet, aber standardmäßig **nicht** als Video aufgezeichnet. Stattdessen zieht der Client periodisch (Default 4 s), bei Klicks und bei manuellen Screenshots einen Frame über `<video>` → `canvas` → `toBlob('image/jpeg', 0.7)`, herunterskaliert auf max. 1600 px Breite.

Ergebnis: ~60–150 KB pro Frame, direkt LLM-tauglich, kein ffmpeg auf Host-Seite, keine Codec-Probleme.

Video-Aufzeichnung bleibt als `recordVideo: true` optional dazuschaltbar — für Timing-Bugs und Animationen. Das Video geht als Anhang mit, nicht in die Analyse.

Audio läuft als **eigener** `MediaRecorder` auf dem Mikrofon-Stream (`audio/webm;codecs=opus`, mono). Sauberer Input für die Transkription, kein Demuxing im Backend.

### 4.3 Zielplattform und Fähigkeitsprüfung

Unterstützt: **Chrome, Edge, Firefox, Safari** auf dem Desktop.

Nicht unterstützt: Mobile und Tablets. iOS Safari kann `getDisplayMedia` überhaupt nicht — das ist keine Einschränkung, die sich wegkonfigurieren lässt.

Der Client prüft beim Init `navigator.mediaDevices?.getDisplayMedia`, `MediaRecorder` und Secure Context. Fehlt etwas oder ist der Viewport mobil, wird der Button **gar nicht erst angezeigt** und `isSupported` meldet `false`, damit die Host-App eine eigene Alternative anbieten kann (z. B. Link auf ein normales Formular). Ein sichtbarer Button, der beim Klick scheitert, ist schlechter als kein Button.

### 4.4 Browser-Details, die in der Umsetzung beißen

| Thema | Umgang |
|---|---|
| User-Gesture | Freigabe nur direkt aus dem Klick heraus — kein `await` vor `getDisplayMedia()` |
| Overlay im Screenshot | Bei Tab-Sharing zeichnet sich das Overlay mit auf: ausblenden → 2× `requestAnimationFrame` → Frame greifen → einblenden |
| Safari | Kein `ImageCapture.grabFrame()` — der Canvas-Weg funktioniert überall und wird durchgängig verwendet |
| Versehentliche Freigabe fremder Fenster | Chrome: `preferCurrentTab` / `selfBrowserSurface` nutzen; im Dialogtext „nur diesen Tab" empfehlen |
| Secure Context | Harter Check im Client, klare Fehlermeldung statt stiller Fehlschlag |

### 4.5 Automatisch erfasster Kontext

Der Teil mit dem besten Aufwand-Nutzen-Verhältnis. Ein Report mit Konsolen-Stacktrace ist für Entwickler oft direkt die Antwort — unabhängig davon, ob ein LLM angebunden ist.

Ringpuffer (Default 50 Einträge), läuft ab Init immer mit, wird nur bei tatsächlicher Meldung übertragen:

- `window.onerror`, `unhandledrejection`, `console.error/warn`
- fehlgeschlagene Requests via `fetch`/`XHR`-Wrapper: Methode, URL, Status, Dauer — **ohne Bodies**
- Klick- und Navigations-Breadcrumbs (Selektor, Route, Zeitstempel)
- URL, Route, Viewport, `devicePixelRatio`, UA, Locale, Zeitzone, App-Version, Build-Hash
- frei definierbarer App-State über `context: () => ({ … })`

### 4.6 Konfiguration

```ts
import { initBugReport } from '@symbiosika/bugreport-client'

const bugReport = initBugReport({
  endpoint: '/api/bugreport',
  app: { id: 'operations-app', version: __APP_VERSION__, environment: 'prod' },

  getAuthHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  reporter: () => ({ id: user.id, name: user.name, email: user.email }),

  capture: {
    recordVideo: false,        // Default: Frame-Sampling
    frameIntervalMs: 4000,
    microphone: true,
    console: { maxEntries: 50 },
    network: true,
    maxDurationMs: 180_000,    // harter Cut nach 3 Minuten
  },

  redact: {
    selectors: ['[data-private]', '.patient-name', 'input[type=password]'],
    urlParams: ['token', 'sig'],
  },

  context: () => ({ route: router.currentRoute.value.fullPath, tenant: store.tenantId }),
  locale: 'de',
  onSubmitted: ({ reportId }) => toast(`Meldung ${reportId} übermittelt`),
})

if (bugReport.isSupported) bugReport.start()
```

Vue-Variante:

```vue
<BugReportButton :config="bugReportConfig" />
<!-- oder -->
const { start, isSupported, state, elapsed } = useBugReport()
```

### 4.7 Redaction

`redact.selectors` überlagert Elemente **vor** dem Frame-Grab mit einem Balken. Das greift nur bei Freigabe des eigenen Tabs — bei Fenster- oder Bildschirmfreigabe kann der Client nichts maskieren. Für sensible Apps gibt es `requireTabCapture: true`; ansonsten muss der Einwilligungstext deutlich warnen.

Overlay läuft im **Shadow DOM** mit eigenem CSS-Reset, damit App-Styles nichts kaputtmachen und umgekehrt.

---

## 5. API-Vertrag zwischen Client und Server

Alle Bodies sind Valibot-validiert und in `core` definiert.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/bugreport/config` | Limits, aktivierte Features, Einwilligungstext, `enabled` |
| `POST` | `/bugreport/session` | Öffnet Report, prüft Auth + Rate-Limit → `{ reportId }` |
| `PUT` | `/bugreport/:id/asset` | Multipart-Upload eines Assets (`kind`, `capturedAt`, `caption?`) |
| `POST` | `/bugreport/:id/submit` | Schließt ab, übergibt Kontext + Einwilligung → `202 { reportId }` |
| `GET` | `/bugreport/:id` | Optionaler Status-/Ergebnisabruf (Polling für Ticketnummer) |

`submit` antwortet sofort mit `202 Accepted`. Transkription und Analyse brauchen 10–60 s — der Nutzer wartet nicht. Die Pipeline läuft asynchron; `GET /:id` liefert später `{ status: 'done', externalUrl }`.

Assets werden einzeln und sofort nach Entstehung hochgeladen, nicht gesammelt am Ende. Das verteilt die Last, zeigt echten Fortschritt und überlebt Verbindungsabbrüche besser.

Der `GET /bugreport/:id`-Endpunkt setzt voraus, dass der Host den Report-Status irgendwo hält. Da es keine modul-eigene Persistenz gibt, geschieht das über den `StorageAdapter` (siehe 6.2). Wer den Status nicht braucht, kann den Endpunkt deaktivieren.

---

## 6. Backend-Modul

### 6.1 Einbindung

Der Kern arbeitet auf Web-Standard `Request`/`Response` — läuft damit auf Bun, Node 18+, Hono, Deno und Workers ohne Adapter-Zoo. Ein dünner Wrapper für Express (Node-Streams ↔ Web-Streams) liegt bei.

```ts
import { createBugReportHandler } from '@symbiosika/bugreport-server'

const handler = createBugReportHandler({
  storage: myStorage,          // Pflicht  — eigene Implementierung
  llm: myLlm,                  // optional — ohne: Report ohne Analyse
  actions: [myGiteaAction],    // Pflicht  — mindestens eine

  auth: async (req) => verifySessionToken(req),   // null ⇒ 401

  limits: {
    maxAssetBytes: 10 * 1024 * 1024,
    maxAssetsPerReport: 40,
    maxImagesToLlm: 6,
    ratePerUserPerHour: 5,
  },

  consent: { version: '1.0', text: '…' },   // wird an /config ausgeliefert
})

app.all('/api/bugreport/*', (c) => handler(c.req.raw))
```

Drei Interfaces, sonst nichts. Keine Secrets, keine Provider-SDKs, keine Anbieterentscheidung im Modul.

### 6.2 Die drei Interfaces

```ts
interface StorageAdapter {
  putAsset(reportId: string, asset: AssetMeta, data: ReadableStream): Promise<{ key: string }>
  getAsset(key: string): Promise<ReadableStream>
  saveReport(report: BugReport): Promise<void>
  getReport(reportId: string): Promise<BugReport | null>
}

interface LlmAdapter {
  transcribe(audio: Blob, opts: { language?: string }): Promise<{ text: string; language: string }>
  analyze(input: AnalysisInput): Promise<BugReportAnalysis>
}

interface BugReportAction {
  name: string
  run(report: BugReport, ctx: ActionContext): Promise<ActionResult | void>
}

interface ActionContext {
  logger: Logger
  storage: StorageAdapter          // Assets als Bytes oder eigene URL holen
}

interface ActionResult { system: string; externalId?: string; externalUrl?: string }
```

**Zum Storage:** Da der Host Speicherort und Lebensdauer bestimmt, liegt auch die Löschfrist bei ihm. Das Modul verspricht keine Retention — es dokumentiert nur, dass sie nötig ist. Das ist die ehrlichere Aufteilung als eine TTL-Option, die auf fremdem Storage ohnehin nicht durchsetzbar wäre.

**Zum LLM:** Der Adapter bekommt einen bereits kuratierten `AnalysisInput` (Transkript, ausgewählte Bilder, Kontext) und liefert ein schemakonformes Ergebnis. Was dazwischen passiert — welcher Anbieter, welches Modell, welcher Prompt, ob On-Prem — geht das Modul nichts an.

Damit nicht jede Integration die Prompt-Arbeit neu macht, exportiert `server` eine reine Funktion `buildAnalysisPrompt(input): { system, messages }` als **optionale** Vorlage. Kein Adapter, keine Abhängigkeit, kein Netzwerkzugriff — nur ein String-Builder, den man nutzen oder ignorieren kann.

Ist `llm` nicht gesetzt, entsteht der Report trotzdem: aus Rohtranskript-freiem Audio-Asset, Screenshots und Kontext, mit `analysisStatus: 'skipped'`. Für Installationen ohne KI-Freigabe ist das der reguläre Betriebsmodus, kein Notfall.

### 6.3 Pipeline

Was das Modul selbst tut:

1. **Transkription** über den Adapter, sofern gesetzt.
2. **Bildauswahl.** Nicht alle Frames weiterreichen. Priorität: (a) manuelle Screenshots, (b) Frames aus Zeitfenstern, in denen im Transkript Hinweiswörter fallen („hier", „jetzt", „das da", „Fehler", „stürzt ab"), (c) erster und letzter Frame. Deckelung über `maxImagesToLlm`. Diese Heuristik bleibt im Modul — sie ist providerunabhängig und für jeden Host gleich.
3. **Analyse** über den Adapter, Ergebnis gegen das Valibot-Schema validiert.
4. **Report zusammensetzen** und über `storage.saveReport` ablegen.
5. **Actions** sequenziell ausführen, fehlertolerant.

**Fallback.** Schlägt Schritt 1 oder 3 fehl, entsteht der Report trotzdem — mit Assets, Kontext und `analysisStatus: 'failed'`. Ein Bug-Report darf nie verloren gehen, nur weil ein Fremdsystem nicht antwortet.

### 6.4 Der normierte Datensatz

Das Herzstück. Was hier steht, ist der Vertrag zu den Actions.

```ts
interface BugReport {
  id: string
  createdAt: string
  status: 'processing' | 'done' | 'failed'

  app:       { id: string; version?: string; environment?: string }
  reporter?: { id?: string; name?: string; email?: string; role?: string }

  // vom LlmAdapter; leer bei analysisStatus 'skipped' | 'failed'
  title: string
  summary: string                  // Markdown, 2–5 Sätze
  stepsToReproduce: string[]
  expectedBehaviour?: string
  actualBehaviour?: string
  severitySuggestion: 'low' | 'medium' | 'high' | 'critical'
  areaSuggestion?: string
  labels: string[]
  confidence: number               // 0–1

  transcript?: { text: string; language: string }
  userComment?: string

  context: {
    url: string; route?: string
    viewport: { width: number; height: number; dpr: number }
    userAgent: string; locale: string; timezone: string
    consoleEntries: LogEntry[]
    networkErrors: NetworkEntry[]
    breadcrumbs: Breadcrumb[]
    custom?: Record<string, unknown>
  }

  assets: Array<{
    key: string                    // vom StorageAdapter vergeben
    kind: 'screenshot' | 'frame' | 'video' | 'audio'
    mimeType: string; bytes: number; capturedAt: string
    caption?: string               // falls vom LlmAdapter geliefert
    usedInAnalysis: boolean
  }>

  consent: { acceptedAt: string; version: string; textHash: string }
  analysisStatus: 'ok' | 'skipped' | 'failed'
  actionResults: ActionResult[]
}
```

Assets führen nur einen `key`, keine URL. Wie daraus ein Link wird — signiert, öffentlich, gar nicht — entscheidet der Host in seinem Storage- oder Action-Code.

### 6.5 Actions

Sequenziell und fehlertolerant: Wirft eine Action, wird das protokolliert, der Report bleibt gespeichert, die übrigen Actions laufen weiter. Ergebnisse landen in `actionResults`, damit `GET /:id` dem Nutzer die Ticketnummer zeigen kann.

Das Modul liefert keine Action mit. In eurem Umfeld dürfte eine Webhook-Action gegen n8n der häufigste Fall sein — von dort ist alles Weitere ohne Code-Änderung routbar. Als Referenz liegt genau das in `examples/`.
