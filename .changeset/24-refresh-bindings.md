---
"babel-dead-code-elimination": patch
---

Update bindings after each elimination pass instead of crawling the whole
program again. Eliminating a chain of dependent declarations now needs a single
scope crawl, independent of the chain's length. Afterwards, the program scope's
`references`, `globals` and `uids` still include names from removed code, so a
later `generateUid` may pick a different, still unique name.
Every scope's bindings then equal a fresh crawl's, also when Babel deleted a
parameter, a catch parameter or a function or class expression's own name
while removing a nested declaration of the same name
(`function g(cfg) { { const cfg = 0 } return () => cfg }`).
