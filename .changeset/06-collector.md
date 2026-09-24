---
"babel-dead-code-elimination": minor
---

Add `collectReferencedIdentifiers`, which collects declarations during an
analysis traversal you already run and computes reference membership only when
its reader is called. This saves a traversal when the analysis finds something
to transform; when it does not, the collected paths are discarded unused.
