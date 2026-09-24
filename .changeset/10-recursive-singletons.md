---
"babel-dead-code-elimination": patch
---

Keep a self-recursive function while another surviving declaration still
references it. It was treated as a closed cycle and removed, leaving a
dangling reference that throws `ReferenceError` when the module loads.
