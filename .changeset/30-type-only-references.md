---
"babel-dead-code-elimination": patch
---

Ignore references inside TypeScript types

A value read only in a type, such as `type T = typeof schema`, `x as typeof schema`, `f<typeof schema>()` or `implements Schema`, was kept, together with its imports. Types are erased, so these references no longer keep a value alive. Fixes #50.
