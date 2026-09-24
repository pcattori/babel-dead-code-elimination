---
"babel-dead-code-elimination": patch
---

Ignore same-named TypeScript type aliases, interfaces and overload signatures
when deciding whether a value is used. `const Schema = …` next to
`type Schema = …` was never removed, keeping its imports alive. Removing a
function now also removes its overload signatures.
