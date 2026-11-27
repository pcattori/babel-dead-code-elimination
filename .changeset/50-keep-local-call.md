---
"babel-dead-code-elimination": minor
---

Add a `keepLocalCall` option to choose which calls keep a declaration inside a function

`deadCodeElimination(ast, candidates, { keepLocalCall })` takes a predicate that decides which calls keep an otherwise unused declaration inside a function. It receives the calls, `new` expressions, tagged templates and applied decorators such a declaration evaluates, in source order until it accepts one, before anything is removed, and the declaration is kept when it accepts one. Without the option every call keeps its declaration, as before, so a hook such as `const id = useId()` still runs in every build; a framework can pass its own rule, for example to keep hooks but remove a data fetch like `const user = getSession().user` from the client build. `findReferencedIdentifiers` and `collectReferencedIdentifiers` take the same option (changeset 54). The `DeadCodeEliminationOptions`, `KeepLocalCall` and `LocalCall` types are exported.
