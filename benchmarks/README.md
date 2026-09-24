# Performance measurements

Each numbered change is compared with its immediate parent, using identical
fixtures and dependencies. Percentages describe elapsed-time changes, not
throughput. Do not add them together or extrapolate them to every application.

## Reproduce

Install the locked dependencies with pnpm, then prepare the two commits to compare:

```sh
node benchmarks/prepare.mjs . /tmp/dce-benchmark --refs CHANGE^ CHANGE
node --expose-gc benchmarks/paired.mjs 01-graph BEFORE/index.mjs AFTER/index.mjs results.json
```

Replace `CHANGE` with a commit and use the two bundle paths printed by preparation
for `BEFORE/index.mjs` and `AFTER/index.mjs`. Select the matching numbered fixture
file. The preparation directory must not already contain those variants. Both
variants resolve Babel from this checkout. Preparation records source, bundle,
and Babel-entry hashes; the runner records fixture hashes and every timing sample.
`--parity-only` checks the fixtures without timing. Run comparisons sequentially,
with other CPU-intensive work stopped.

Measurements below were recorded on an Apple M4 with Node 24.8.0 and Babel 7.24.6.
The initial measurements used esbuild 0.28.2. The portable preparer uses esbuild
from the installed Vitest/Vite dependencies (0.20.2 here); all eight prepared
variants were verified to have identical executable code after removing comments.
No Babel code is bundled into either variant.

The default protocol uses 32 warmups and nine alternating AB/BA paired batches.
Each fixture defines its fixed iteration count. Parsing, initial scope setup,
reference capture, rewrites, and explicit GC are outside primitive measurements.
Pipeline measurements include parse, analysis, rewrite, DCE, and generation.
Graph cases reuse an immutable scoped AST; mutating cases use fresh ASTs.
Before timing, the runner asserts generated code/source-map or reference-membership
parity. All 44 primary cases passed. Tables show microseconds per operation,
median and interquartile range (IQR). IQR is descriptive, not a confidence interval.
Overlapping ranges do not establish equivalence or a reliable speedup.

The results measure CPU time. Allocation implications are described per change;
there are no quantitative heap-size claims and no added global caches.

## 01-graph: Constant-time graph edge deduplication

References to one target binding are processed together. Checking the last edge
replaces a growing-array search without a new collection. Wide and repeated-edge
cases have clearly separated ranges; sparse/externally referenced controls do not.
The empty control differs by only about 8.5 ns. The pipeline ranges overlap.

| Workload               | Phase    |              Before µs (IQR) |               After µs (IQR) | Time change |
| ---------------------- | -------- | ---------------------------: | ---------------------------: | ----------: |
| dependency-registry-48 | graph    |          7.891 (7.372–9.539) |          6.765 (6.650–8.916) |     -14.27% |
| wide-registry-512      | graph    |       96.029 (95.624–96.476) |       74.735 (73.785–75.515) |     -22.17% |
| repeated-edges-256x4   | graph    |       82.975 (82.494–84.322) |       59.815 (59.425–60.585) |     -27.91% |
| sparse-cycle-32        | graph    |          6.536 (5.014–6.709) |          6.563 (4.989–6.718) |      +0.42% |
| externally-used-48     | graph    |          4.780 (4.737–4.861) |          4.846 (4.804–4.864) |      +1.38% |
| empty-bindings         | graph    |          0.081 (0.080–0.087) |          0.089 (0.081–0.091) |     +10.49% |
| registry-48-end-to-end | pipeline | 1444.555 (1414.052–1479.216) | 1253.740 (1129.385–1469.763) |     -13.21% |

## 02-scopes: Reuse fresh scopes

The opt-in flag skips a redundant scope crawl when an earlier read-only traversal
has already initialized scopes. Default behavior still refreshes scopes after
arbitrary edits. This avoids rebuilding binding/reference metadata; it adds no cache.

| Workload             | Phase      |              Before µs (IQR) |               After µs (IQR) | Time change |
| -------------------- | ---------- | ---------------------------: | ---------------------------: | ----------: |
| typical-module       | references |    382.793 (371.658–385.298) |    157.113 (148.708–189.214) |     -58.96% |
| many-nested-scopes   | references | 3910.872 (3774.779–4016.776) | 1693.148 (1619.297–1796.581) |     -56.71% |
| tiny-module          | references |         9.892 (9.674–10.222) |          4.593 (4.447–4.791) |     -53.57% |
| default-api-control  | references |    890.135 (885.276–892.034) |    887.898 (878.151–905.305) |      -0.25% |
| schema-40-end-to-end | pipeline   | 5890.935 (5781.365–5995.495) | 5499.375 (5371.797–5573.023) |      -6.65% |
