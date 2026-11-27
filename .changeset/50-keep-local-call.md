---
"babel-dead-code-elimination": minor
---

Add a `keepLocalCall` option to choose which calls keep a declaration inside a function

`deadCodeElimination(ast, candidates, { keepLocalCall })` takes a predicate that decides which calls keep an otherwise unused declaration inside a function. It receives the calls, `new` expressions, tagged templates and applied decorators such a declaration evaluates, in source order until it accepts one, before anything is removed, and the declaration is kept when it accepts one. Without the option every call keeps its declaration (changesets 27 and 36), so a hook such as `const id = useId()`, which 2.0.0 removed when nothing read it, runs in every build; a framework can pass its own rule, for example to keep hooks but remove a data fetch like `const user = getSession().user` from the client build. `findReferencedIdentifiers` and `collectReferencedIdentifiers` take the same option (changeset 54). The `DeadCodeEliminationOptions`, `KeepLocalCall` and `LocalCall` types are exported.

Upgrading: since changesets 27 and 36, a client-only call in a function local, such as `const layout = localStorage.getItem('layout')` under `<ClientOnly>`, stays in server builds unless the option rejects it; pass a rule such as the README's hook rule to remove it again.
