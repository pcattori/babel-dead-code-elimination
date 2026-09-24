---
"babel-dead-code-elimination": patch
---

Replay declaration and pattern paths after the first DCE traversal instead of
traversing unchanged expressions again. Rebuild scopes after removals and skip
paths detached by ancestor removal or array-hole writes.

On Apple M4 / Node 24.8.0 / Babel 7.24.6, DCE took 4170.451 → 3562.930 µs for a
schema among 80 live functions (14.57% less time), 1168.414 → 874.133 µs for a
24-link cascade (25.19% less), and 729.581 → 660.130 µs for nested declarations
(9.52% less). Pipeline times were 11473.448 → 10735.862 µs (6.43% less) and
2265.888 → 2007.469 µs for a cascade (11.40% less). The no-removal control was
2373.380 → 2423.523 µs (+2.11%, overlapping ranges). The tradeoff is a local array
of visited declaration/pattern paths retained until DCE returns. See
`benchmarks/README.md` and `05-replay.mjs`.
