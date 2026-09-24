---
"babel-dead-code-elimination": patch
---

Keep cycle members that a declaration outside the `candidates` set still
references. Such declarations are never removed, but the cycle analysis
ignored them and could remove the candidate they call.
