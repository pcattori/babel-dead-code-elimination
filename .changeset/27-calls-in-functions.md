---
"babel-dead-code-elimination": patch
---

Keep declarations inside functions whose initializer is a call, such as
`const id = useId()`, even when their bindings become unused. Removing them
from one build only (for example the server build) changed which hooks run and
broke hydration.

Upgrading: without `keepLocalCall`, a client-only call in a function local now stays in server builds too, such as `const layout = localStorage.getItem('layout')` in a component rendered under `<ClientOnly>`; 2.0.0 removed such a local when nothing read it. Pass `keepLocalCall` (changeset 50) to choose which calls keep their declaration and get that removal back.
