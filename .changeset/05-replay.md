---
"babel-dead-code-elimination": patch
---

Replay the collected declaration paths after the first elimination pass instead
of traversing the whole AST again. Later passes still refresh scopes, but no
longer revisit expressions.
