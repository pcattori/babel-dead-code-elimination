---
"babel-dead-code-elimination": patch
---

Ignore values used as computed keys inside TypeScript types

A value read only as a computed key in a type, such as `k` in `interface I { [k]: number }` or `type T = { [k.key](): void }`, was kept, together with its imports. Types are erased, so these keys no longer keep a value alive, like other references inside types.
