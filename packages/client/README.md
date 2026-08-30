# @symbiosika/bugreport-client

Browser-SDK (Vanilla TS, zero dependencies außer `-core`) für zeigend-sprechende
Fehlermeldungen: Overlay-UI im Shadow DOM, `getDisplayMedia`-Frame-Sampling
statt Video, Mikrofon-Aufnahme, Kontext-Collector (Konsole, Netzwerkfehler,
Breadcrumbs), Redaction und Upload-Protokoll.

```ts
import { initBugReport } from '@symbiosika/bugreport-client'

const bugReport = initBugReport({
  endpoint: '/api/bugreport',
  app: { id: 'my-app', version: '1.2.3', environment: 'prod' },
  getAuthHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  reporter: () => ({ id: user.id, name: user.name }),
  redact: { selectors: ['[data-private]'], urlParams: ['token'] },
  locale: 'de',
  onSubmitted: ({ reportId }) => toast(`Meldung ${reportId} übermittelt`),
})

if (bugReport.isSupported) {
  myButton.addEventListener('click', () => bugReport.start())
} else {
  // Desktop-only: auf Mobile eigene Alternative anbieten (z. B. Formular)
}
```

Zielplattform: Chrome, Edge, Firefox, Safari auf dem Desktop. Auf nicht
unterstützten Plattformen meldet `isSupported` `false` — der Button soll dann
gar nicht erst erscheinen.

Siehe das [Monorepo-README](https://github.com/symbiosika/bugreport).
