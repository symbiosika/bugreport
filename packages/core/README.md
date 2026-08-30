# @symbiosika/bugreport-core

Typen, Valibot-Schemas und API-Contract für das Bug-Reporting-Modul — die
einzige gemeinsame Abhängigkeit von `@symbiosika/bugreport-client` und
`@symbiosika/bugreport-server`. Ändert sich der normierte Datensatz
(`BugReport`), brechen beide Seiten zur Compile-Zeit gleichzeitig.

Einzige Runtime-Dependency: `valibot` (tree-shakeable).

Siehe das [Monorepo-README](https://github.com/symbiosika/bugreport) für die
Gesamtübersicht.
