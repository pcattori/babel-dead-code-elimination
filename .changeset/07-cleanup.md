---
"babel-dead-code-elimination": patch
---

Remove duplicate candidate-membership checking and unreachable FunctionDeclaration
parent handling. These are maintainability changes; no speedup is claimed.

On Apple M4 / Node 24.8.0 / Babel 7.24.6, the initial candidate-filtered DCE medians
were 543.787 → 570.060 µs (+4.83%) for variables and 199.401 → 221.125 µs
(+10.89%) for functions, with overlapping ranges. A longer warmup/15-pair
confirmation measured 496.979 → 489.992 µs (−1.41%) and 189.156 → 193.542 µs
(+2.32%). Its pipeline measured 1451.648 → 1530.333 µs (+5.42%), also with
overlapping ranges. Isolated 15-pair diagnostics measured +1.58% for membership
cleanup and +0.02% for parent cleanup. These results do not establish a reliable
speed improvement or equivalence. See `benchmarks/README.md` for both primary
runs, controls, and diagnostics; the change adds no allocation.
