---
"babel-dead-code-elimination": patch
---

Remove unused class declarations like other declarations. Only class
expressions (`const Repo = class {}`) were removed before, so a class used
only by stripped code kept its imports, including server-only modules.
