---
"babel-dead-code-elimination": patch
---

Rebuild nested scopes whenever scopes are refreshed. Babel's Program crawl
kept scopes inside functions that were already initialized, so declarations
there that became unused (through your transform or through elimination
itself) were kept, and the result depended on whether the AST had been
traversed before the transform.
