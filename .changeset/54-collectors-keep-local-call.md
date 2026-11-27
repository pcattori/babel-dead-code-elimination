---
"babel-dead-code-elimination": patch
---

Let `findReferencedIdentifiers` and `collectReferencedIdentifiers` take `keepLocalCall`

The collectors counted every call when deciding which locals inside a function are used, while `deadCodeElimination` given `keepLocalCall` counts only the calls the option accepts. With a rule that keeps hooks, the README workflow with no transform then removed code that was already unused: in `const session = getSession(refresh); function refresh() { return session }`, the set held both names, which only the rejected `getSession(...)` call keeps alive, and elimination removed them with the `./auth.server` import. The collectors now take the same option and decide liveness by the same rule; pass `{ keepLocalCall }` to both calls.
