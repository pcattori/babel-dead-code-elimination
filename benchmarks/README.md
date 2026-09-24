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

## 03-imports: Stop after import-only removals

Removing an import cannot remove a reference to another local binding. Only
non-import removals now request another scope crawl/elimination pass. Original
bare side-effect imports remain intact. This also avoids the allocation work of
the redundant pass. All-live and bare-import control ranges overlap.

| Workload                   | Phase    |              Before µs (IQR) |               After µs (IQR) | Time change |
| -------------------------- | -------- | ---------------------------: | ---------------------------: | ----------: |
| stripped-schema-import     | dce      | 2002.016 (1957.188–2060.594) | 1106.159 (1046.372–1143.813) |     -44.75% |
| 64-imports-amid-live-code  | dce      | 2304.542 (2264.508–2359.193) | 1448.154 (1332.060–1528.182) |     -37.16% |
| variable-to-import-cascade | dce      | 1832.591 (1801.826–1890.802) | 1372.182 (1367.656–1503.375) |     -25.12% |
| all-imports-live-control   | dce      | 1129.044 (1066.055–1152.000) |  1105.281 (946.190–1130.849) |      -2.10% |
| bare-imports-control       | dce      |       22.714 (19.948–23.781) |       20.406 (19.461–22.073) |     -10.16% |
| stripped-schema-end-to-end | pipeline | 5820.107 (5725.354–5946.872) | 5207.050 (5142.448–5294.284) |     -10.53% |

## 04-checks: Avoid unnecessary destructuring checks

Nonempty patterns skip ancestor searches; object-rest detection inspects the last
AST property without requesting an array of NodePaths. This removes unnecessary
work and temporary path-array allocation. All measured ranges overlap, so the
small median differences do not establish a general speedup.

| Workload                      | Phase    |              Before µs (IQR) |               After µs (IQR) | Time change |
| ----------------------------- | -------- | ---------------------------: | ---------------------------: | ----------: |
| live-nonempty-patterns        | dce      | 1852.854 (1746.977–1939.708) | 1780.836 (1704.253–1893.398) |      -3.89% |
| live-object-rest-exclusions   | dce      |    780.763 (772.453–843.687) |    767.550 (765.289–773.148) |      -1.69% |
| empty-nested-pattern-cleanup  | dce      |       38.997 (37.268–41.583) |       39.003 (35.188–45.338) |      +0.01% |
| no-pattern-no-removal-control | dce      |   939.875 (915.318–1002.865) |    946.206 (911.810–979.857) |      +0.67% |
| live-patterns-end-to-end      | pipeline | 8266.367 (8172.148–8384.055) | 8243.539 (8130.651–8306.510) |      -0.28% |

## 05-replay: Replay declaration paths

After the first elimination traversal, replay the declaration/pattern paths in
source order. Scopes and cycle membership are still refreshed after non-import
removal. Expressions no longer need another full traversal. The guard checks
removed ancestors and direct array-hole writes, the only structural mutations
performed by DCE. It does not use reflection or general-purpose resynchronization.
Replay retains O(visited declaration/pattern paths) references until DCE returns;
there is no cross-call cache. The no-removal control ranges overlap.

| Workload                          | Phase    |                 Before µs (IQR) |                  After µs (IQR) | Time change |
| --------------------------------- | -------- | ------------------------------: | ------------------------------: | ----------: |
| one-dead-schema-80-live-functions | dce      |    4170.451 (4128.055–4243.807) |    3562.930 (3531.193–3676.409) |     -14.57% |
| 24-link-cascade                   | dce      |    1168.414 (1158.599–1247.253) |       874.133 (865.529–880.562) |     -25.19% |
| nested-pattern-removed-subtrees   | dce      |       729.581 (721.273–737.398) |       660.130 (640.969–695.984) |      -9.52% |
| no-removal-control                | dce      |    2373.380 (2365.469–2402.424) |    2423.523 (2366.909–2491.633) |      +2.11% |
| empty-array-parameter-control     | dce      |          24.914 (24.076–26.664) |          20.151 (19.734–20.797) |     -19.12% |
| tiny-removal-control              | dce      |          26.307 (23.143–27.164) |          19.870 (17.549–20.963) |     -24.47% |
| schema-80-end-to-end              | pipeline | 11473.448 (11359.482–11511.552) | 10735.862 (10659.930–10929.878) |      -6.43% |
| 24-link-cascade-end-to-end        | pipeline |    2265.888 (2201.336–2301.091) |    2007.469 (1939.810–2017.352) |     -11.40% |

## 06-collector: Share analysis and reference collection

The opt-in collector combines a complete read-only analysis visitor with
collection of declaration paths, then defers graph/reference membership until
requested. The returned reader must run before AST or binding mutation. Default
scope refresh runs before generic and typed Program callbacks, including when a
visitor object is reused. The existing eager API still streams identifiers.
Accepted transforms benefit, but discarded matches allocate/retain declaration
paths unnecessarily. That cost is measured below; the API is not an unconditional
replacement for an analysis-only traversal. The reader retains its paths until
the caller discards it, with no global cache.

| Workload                           | Phase      |              Before µs (IQR) |               After µs (IQR) | Time change |
| ---------------------------------- | ---------- | ---------------------------: | ---------------------------: | ----------: |
| accepted-schema-16                 | analysis   |    272.276 (265.871–276.392) |    161.719 (157.677–168.423) |     -40.60% |
| accepted-schema-80                 | analysis   | 1836.242 (1791.805–1852.463) | 1204.432 (1132.958–1208.721) |     -34.41% |
| discarded-validator-calls-200      | analysis   |    470.953 (454.703–480.990) |    494.315 (491.435–497.591) |      +4.96% |
| discarded-validator-references-200 | analysis   |    333.391 (328.450–342.682) |    373.643 (363.185–375.716) |     +12.07% |
| tiny-accepted                      | analysis   |          7.703 (7.672–7.992) |          7.401 (7.120–7.999) |      -3.93% |
| default-collector-refresh          | analysis   |    532.522 (514.168–548.243) |    407.318 (406.880–453.967) |     -23.51% |
| default-api-control                | references |    917.508 (912.599–942.802) |    915.818 (905.378–923.013) |      -0.18% |
| schema-80-end-to-end               | pipeline   | 9542.250 (9476.971–9666.201) | 8994.841 (8949.544–9094.828) |      -5.74% |
| discarded-200-end-to-end           | pipeline   | 3928.060 (3917.099–4059.953) | 4057.328 (4028.185–4084.271) |      +3.29% |

## 07-cleanup: Remove redundant declaration checks

Remove a second candidate-membership check already enforced on entry and an
unreachable FunctionDeclaration parent branch: variable initializers and assignment
right-hand sides contain expressions, not FunctionDeclarations. This is a code
simplification, not a demonstrated speedup. Initial medians were slower with
substantially overlapping ranges. The confirmation and isolated diagnostics below
are retained rather than selecting the most favorable run. No new allocations.

| Workload                         | Phase    |              Before µs (IQR) |               After µs (IQR) | Time change |
| -------------------------------- | -------- | ---------------------------: | ---------------------------: | ----------: |
| candidate-filtered-128-variables | dce      |    543.787 (532.362–566.815) |    570.060 (512.865–584.737) |      +4.83% |
| candidate-filtered-48-functions  | dce      |    199.401 (191.586–209.409) |    221.125 (194.578–227.216) |     +10.89% |
| no-removal-control               | dce      | 1034.273 (1008.536–1201.234) |  1021.005 (896.760–1193.393) |      -1.28% |
| 48-functions-end-to-end          | pipeline | 1518.490 (1291.510–1623.797) | 1642.398 (1478.901–1692.833) |      +8.16% |

Confirmation: 256 warmups and 15 paired batches, otherwise the same primary fixture.

| Workload                         | Phase    |              Before µs (IQR) |               After µs (IQR) | Time change |
| -------------------------------- | -------- | ---------------------------: | ---------------------------: | ----------: |
| candidate-filtered-128-variables | dce      |    496.979 (486.513–533.974) |    489.992 (485.018–536.352) |      -1.41% |
| candidate-filtered-48-functions  | dce      |    189.156 (186.284–200.089) |    193.542 (184.737–215.161) |      +2.32% |
| no-removal-control               | dce      |  1039.323 (926.958–1178.049) |  1035.018 (935.362–1196.776) |      -0.41% |
| 48-functions-end-to-end          | pipeline | 1451.648 (1387.125–1650.503) | 1530.333 (1390.651–1688.404) |      +5.42% |

Isolated diagnostics: each deletion separately against the pre-cleanup source,
256 warmups, 15 paired batches of 128 prepared operations. Both IQRs overlap.

| Workload                         | Phase |           Before µs (IQR) |            After µs (IQR) | Time change |
| -------------------------------- | ----- | ------------------------: | ------------------------: | ----------: |
| candidate-filtered-128-variables | dce   | 600.662 (591.384–610.185) | 610.141 (595.975–621.478) |      +1.58% |

| Workload                        | Phase |           Before µs (IQR) |            After µs (IQR) | Time change |
| ------------------------------- | ----- | ------------------------: | ------------------------: | ----------: |
| candidate-filtered-48-functions | dce   | 226.058 (219.203–235.103) | 226.108 (223.016–233.229) |      +0.02% |

The primary confirmation can be repeated with `DCE_BENCH_WARMUPS=256 DCE_BENCH_SAMPLES=15`.
The isolated fixtures require a source variant containing just that deletion;
prepare it with `--sources BEFORE_DIRECTORY AFTER_DIRECTORY` instead of `--refs`.
