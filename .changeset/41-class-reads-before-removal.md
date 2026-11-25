---
"babel-dead-code-elimination": patch
---

Decide whether an unused class runs code before removing anything

An unused class whose static field, static accessor or computed key only reads a module name, such as `const cfg = load(); class C { static x = cfg }`, was kept while `cfg` was removed, leaving a reference to a removed name that throws a `ReferenceError` when the module loads; a server-only import read this way stayed in the client build. Elimination removed `cfg` first, after which the class's read looked like a read of a global, which may throw and so counts as running code. Whether a class runs code is now decided before the first removal, so such a class and the names only it reads are removed together.
