# @symbiosika/bugreport-client

Browser SDK (vanilla TS, zero dependencies besides `-core`) for show-and-tell
bug reports: overlay UI in Shadow DOM, `getDisplayMedia` frame sampling
instead of video, microphone recording, context collector (console, failed
requests, breadcrumbs), redaction, and the upload protocol.

```ts
import { initBugReport } from '@symbiosika/bugreport-client'

const bugReport = initBugReport({
  endpoint: '/api/bugreport',
  app: { id: 'my-app', version: '1.2.3', environment: 'prod' },
  getAuthHeaders: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  reporter: () => ({ id: user.id, name: user.name }),
  redact: { selectors: ['[data-private]'], urlParams: ['token'] },
  locale: 'en',
  onSubmitted: ({ reportId }) => toast(`Report ${reportId} submitted`),
})

if (bugReport.isSupported) {
  myButton.addEventListener('click', () => bugReport.start())
} else {
  // desktop-only: offer your own alternative on mobile (e.g. a plain form)
}
```

Target platforms: Chrome, Edge, Firefox, Safari on desktop. On unsupported
platforms `isSupported` reports `false` — don't render the button there.

Full option reference:
[integration guide](https://github.com/symbiosika/bugreport/blob/main/docs/INTEGRATION.md).

## License

MIT © Symbiosika GmbH
