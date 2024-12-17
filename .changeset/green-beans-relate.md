---
"babel-dead-code-elimination": patch
---

Do not eliminate `const`- nor `let`-declared for-loop iterator variables

Previously, only `var`-declared iterator variables were preserved within `for...of` and `for...in` loops.
Now, iterator variables declared via `const` and `let` are also preserved.
