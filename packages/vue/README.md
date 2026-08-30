# @symbiosika/bugreport-vue

Dünner Vue-3-Wrapper über `@symbiosika/bugreport-client`.

```vue
<script setup>
import { BugReportButton } from '@symbiosika/bugreport-vue'
const config = { endpoint: '/api/bugreport', app: { id: 'my-app' } }
</script>

<template>
  <!-- rendert nichts, wenn die Plattform nicht unterstützt wird -->
  <BugReportButton :config="config" />
</template>
```

Oder als Composable:

```ts
const { start, isSupported, state } = useBugReport(config)
```

Siehe das [Monorepo-README](https://github.com/symbiosika/bugreport).
