---
"babel-dead-code-elimination": patch
---

Deduplicate binding-graph edges in constant time by reusing reference iteration order.

On Apple M4 / Node 24.8.0 / Babel 7.24.6, graph analysis took 96.029 → 74.735 µs
for 512 dependencies (22.17% less time) and 82.975 → 59.815 µs for repeated
references (27.91% less). The sparse-cycle control was 6.536 → 6.563 µs (+0.42%).
The pipeline median was 1444.555 → 1253.740 µs (13.21% less), with overlapping
interquartile ranges; that does not establish a pipeline speedup. No new graph
storage is allocated. See `benchmarks/README.md` and `01-graph.mjs` for all cases
and the paired comparison protocol.
