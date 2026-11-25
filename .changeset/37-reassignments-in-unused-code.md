---
"babel-dead-code-elimination": patch
---

Remove variables that only unused code reassigns, even when that code reads them

A reassignment kept its variable whenever the code doing it was kept, but that code could be kept only by the variable itself: in `let cache = memo(() => refresh); function refresh() { cache = load() }`, nothing else reads `cache` or `refresh`, yet both stayed. A reassignment now counts like a read from the declaration that contains it, so it keeps the variable only when that declaration is kept for another reason. Both are removed here, as is `let state = init(() => { state = 0 })` when nothing reads `state`. Reassignments in top-level statements and in kept code still keep their variable.
