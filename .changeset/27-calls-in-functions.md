---
"babel-dead-code-elimination": patch
---

Keep declarations inside functions whose initializer is a call, such as
`const id = useId()`, even when their bindings become unused. Removing them
from one build only (for example the server build) changed which hooks run and
broke hydration.
