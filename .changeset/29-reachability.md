---
"babel-dead-code-elimination": patch
---

Find removable bindings by reachability instead of strongly connected components

A binding that nothing elimination keeps can reach is dead, whether it is in a cycle or only referenced by other dead code. Such bindings are now removed in the same pass instead of over several passes, and the cycle search is gone.
