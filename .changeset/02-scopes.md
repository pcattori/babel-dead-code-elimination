---
"babel-dead-code-elimination": minor
---

Allow `findReferencedIdentifiers(ast, { scopeIsFresh: true })` to reuse scopes
from an earlier read-only traversal. The default continues to rebuild scopes.

On Apple M4 / Node 24.8.0 / Babel 7.24.6, typical reference collection took
382.793 → 157.113 µs (58.96% less time), nested declarations 3910.872 → 1693.148 µs
(56.71% less), and tiny modules 9.892 → 4.593 µs (53.57% less). The full pipeline
took 5890.935 → 5499.375 µs (6.65% less). Default behavior was 890.135 → 887.898 µs
(−0.25%, overlapping ranges). Reusing scopes avoids their reconstruction without
retaining additional state. See `benchmarks/README.md` and `02-scopes.mjs`.
