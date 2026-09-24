---
"babel-dead-code-elimination": patch
---

Crawl scopes once instead of twice when `findReferencedIdentifiers`,
`collectReferencedIdentifiers` or `deadCodeElimination` is the first scope-aware
traversal of an AST, such as right after parsing.
