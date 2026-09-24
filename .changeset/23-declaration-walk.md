---
"babel-dead-code-elimination": patch
---

Find declarations in `findReferencedIdentifiers` with a plain walk over the AST
instead of a second Babel traversal. The returned paths are the same objects in
the same order.
