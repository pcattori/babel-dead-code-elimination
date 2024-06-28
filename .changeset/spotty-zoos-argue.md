---
"babel-dead-code-elimination": patch
---

Do not eliminate unreferenced variables from array patterns and object patterns when they do not match the provided candidates

Previously, the `candidates` were passed in to `deadCodeElimination` were not consulted when removing unreferenced variables from within patterns.
This was a bug and has now been fixed.
