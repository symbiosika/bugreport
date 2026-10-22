# @symbiosika/bugreport-vue

Thin Vue 3 wrapper around `@symbiosika/bugreport-client`.

```vue
<script setup>
import { BugReportButton } from '@symbiosika/bugreport-vue'
const config = { endpoint: '/api/bugreport', app: { id: 'my-app' } }
</script>

<template>
  <!-- renders nothing when the platform is not supported -->
  <BugReportButton :config="config" />
</template>
```

Or as a composable:

```ts
const { start, isSupported, state } = useBugReport(config)
```

See the [monorepo README](https://github.com/symbiosika/bugreport) and the
[integration guide](https://github.com/symbiosika/bugreport/blob/main/docs/INTEGRATION.md).

## License

MIT © Symbiosika GmbH
