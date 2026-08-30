# @symbiosika/bugreport-core

Shared types, valibot schemas and the API contract for the bug reporting
module — the single shared dependency of `@symbiosika/bugreport-client` and
`@symbiosika/bugreport-server`. If the normalized `BugReport` record changes,
both sides break at compile time simultaneously.

Only runtime dependency: `valibot` (tree-shakeable).

See the [monorepo README](https://github.com/symbiosika/bugreport) for the
full picture and the
[integration guide](https://github.com/symbiosika/bugreport/blob/main/docs/INTEGRATION.md)
for the data model.
