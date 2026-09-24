---
"babel-dead-code-elimination": patch
---

Skip ancestor checks for nonempty patterns and inspect object-rest AST nodes
directly instead of requesting property NodePaths.

On Apple M4 / Node 24.8.0 / Babel 7.24.6, live destructuring took
1852.854 → 1780.836 µs (3.89% less time), object rest 780.763 → 767.550 µs
(1.69% less), and the pipeline 8266.367 → 8243.539 µs (0.28% less).
All ranges overlap: no reliable pipeline speedup is claimed. The no-pattern
control was 939.875 → 946.206 µs (+0.67%). The change avoids needless ancestor
walks and property-path arrays. See `benchmarks/README.md` and `04-checks.mjs`.
