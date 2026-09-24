---
"babel-dead-code-elimination": minor
---

Allow `findReferencedIdentifiers(ast, { scopeIsFresh: true })` to reuse scopes
from an earlier read-only traversal, which skips one full scope crawl. The
default continues to rebuild scopes.
