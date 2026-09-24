---
"babel-dead-code-elimination": patch
---

Only clean up empty patterns that are part of a variable declaration's id.
Empty patterns in parameters, `catch` clauses or TypeScript function types
inside an initializer (`const f: ({}: P) => void = g`, `const f = ({} = {}) =>
1`) crashed elimination or dropped a parameter's runtime validation
(`([[]]) => 42` became `([,]) => 42`). Unexpected nodes in ASTs traversed
without a file now raise the intended error instead of a `TypeError`.
