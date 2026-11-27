---
"babel-dead-code-elimination": patch
---

Remove unused cycles inside functions and blocks

Declarations that only read each other at the top of a module have been removed together since 1.0.11, and `findReferencedIdentifiers` leaves such closed cycles out of its set. The same declarations inside a function body or a block stayed, as in `function f() { const a = () => b(); const b = () => a(); return 1 }`, because each still had a reader. They are now removed, and `findReferencedIdentifiers` and `collectReferencedIdentifiers` leave them out as well. Locals that something kept reads, loop heads, and declarations that call something when they run (changesets 27 and 46) stay as before.
