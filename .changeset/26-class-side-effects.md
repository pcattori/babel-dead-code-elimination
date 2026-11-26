---
"babel-dead-code-elimination": patch
---

Keep unused classes whose definition runs code: decorators (for example a
`@customElement` registration), static blocks, computed keys with side
effects, and `extends` clauses other than a plain name. A static field's
initializer is treated like a constant's initializer: an unused class whose
only effects are static initializers, such as `class Repo { static db =
connect() }`, is removed with them, and inside a function a class whose static
initializer calls something is kept like `const db = connect()`.
Whether a class runs code is decided for every class before anything is
removed, so removing a declaration that redeclares a name the class reads
(`{ const cfg = 0 } { class C { [cfg]() {} } }`) cannot make the class look
like it reads a global.
