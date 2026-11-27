---
"babel-dead-code-elimination": patch
---

Keep what a declarator with an already-empty pattern reads when candidates are given

With candidates, a pattern that was empty to begin with stays (changeset 28), and so does the declarator that holds it, such as `const { a, k: {} = def(q) } = mk()`. The reachability change (changeset 29) still let the declarator's other names decide what its initializer and that pattern's default read, so removing the unused candidate `a` also removed `q`, and the output referenced a name it no longer declared. What such a declarator reads now counts as read by kept code.
