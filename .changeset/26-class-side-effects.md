---
"babel-dead-code-elimination": patch
---

Keep unused classes whose definition runs code: decorators (for example a
`@customElement` registration), static blocks, static initializers or computed
keys with side effects, and `extends` clauses other than a plain name.
Whether a class runs code is decided for every class before anything is
removed, so removing a declaration that redeclares a name the class reads
(`{ const cfg = 0 } { class C { [cfg]() {} } }`) cannot make the class look
like it reads a global.
