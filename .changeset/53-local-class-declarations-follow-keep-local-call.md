---
"babel-dead-code-elimination": patch
---

With `keepLocalCall`, judge a class declaration inside a function like a class expression

A class declaration inside a function stayed whenever its definition ran code, even when the `keepLocalCall` option rejected every call in it, while the same class written as `const Repo = class { ... }` went. With the option, a class declaration inside a function is now kept only for a call, `new`, tagged template or decorator the option accepts, so `class Repo { static { db.connect() } }` and its server-only import go from a client build whose rule keeps only hooks. Without the option nothing changes: a class whose definition runs code stays.
