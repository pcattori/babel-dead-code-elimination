---
"babel-dead-code-elimination": patch
---

Remove an unused `var` variable wherever it is declared again

Changeset 44 removes an unused `var` with its redeclarations, but it only recognized a redeclaration that stood directly in a block or the program: `var x = load()` stayed when `x` was declared again in a `switch` case, after a label or as the braceless body of an `if` or a loop (`if (k) var x`). Such redeclarations now count too, so the unused variable is removed with all of them. A loop head (`for (var x of xs)`) still assigns the variable on every iteration and keeps it.
