---
"babel-dead-code-elimination": patch
---

Keep patterns that were already empty when candidates are given

`deadCodeElimination(ast, candidates)` removed `const {} = init()` and its initializer even though no candidate was involved, and even with an empty candidate set. Now, with candidates, only patterns that elimination itself emptied are cleaned up.
