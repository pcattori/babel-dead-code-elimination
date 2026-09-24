---
"babel-dead-code-elimination": minor
---

Add `collectReferencedIdentifiers` to share a complete read-only analysis visitor
with declaration collection and defer reference membership until requested.
Refresh scopes before all supplied callbacks by default, including reused visitors.

On Apple M4 / Node 24.8.0 / Babel 7.24.6, accepted analyses took
272.276 → 161.719 µs (40.60% less time) and 1836.242 → 1204.432 µs (34.41% less).
The accepted pipeline took 9542.250 → 8994.841 µs (5.74% less).
There is an opt-in cost when analysis discards the match: 470.953 → 494.315 µs
(+4.96%) and 333.391 → 373.643 µs (+12.07%) from collecting unused declaration
paths. Its discarded pipeline was 3928.060 → 4057.328 µs (+3.29%, overlapping
ranges). The existing eager API was 917.508 → 915.818 µs (−0.18%, overlapping
ranges). The reader retains paths until discarded; invoke it before mutation.
See `benchmarks/README.md` and `06-collector.mjs` for all cases.
