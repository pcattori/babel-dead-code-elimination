---
"babel-dead-code-elimination": patch
---

Resolve a function declaration's name in the scope that declares it. A
parameter or local with the same name (`function session(session) {}`) was
mistaken for the function's binding, so used functions could be removed and
unused ones kept.
