---
"babel-dead-code-elimination": patch
---

Keep unused classes whose definition runs code: decorators (for example a
`@customElement` registration), static blocks, static initializers or computed
keys with side effects, and `extends` clauses other than a plain name.
