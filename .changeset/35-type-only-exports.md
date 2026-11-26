---
"babel-dead-code-elimination": patch
---

Ignore type-only exports when deciding whether a value is used

`export type { schema }` and `export { type schema }` kept `schema` alive, together with its imports, although they export only its type. They no longer keep a value alive. When the value is removed and no type of the same name is left, the type-only export goes with it, since it would name nothing and TypeScript parsers reject it. Removing such an export leaves every binding in scope, also one that the export's alias names (`export type { s as t }` next to `const t`).
