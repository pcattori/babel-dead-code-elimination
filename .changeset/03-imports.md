---
"babel-dead-code-elimination": patch
---

Stop elimination after import-only removals, while preserving original side-effect
imports. Removing imports cannot make another local binding dead.

On Apple M4 / Node 24.8.0 / Babel 7.24.6, DCE took 2002.016 → 1106.159 µs for a
stripped schema import (44.75% less time), 2304.542 → 1448.154 µs for 64 unused
imports (37.16% less), and 1832.591 → 1372.182 µs for a cascade ending in an import
(25.12% less). The pipeline took 5820.107 → 5207.050 µs (10.53% less). The all-live
control was 1129.044 → 1105.281 µs (−2.10%, overlapping ranges). This avoids an
extra traversal and scope rebuild. See `benchmarks/README.md` and `03-imports.mjs`.
