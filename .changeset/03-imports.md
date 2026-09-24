---
"babel-dead-code-elimination": patch
---

Stop elimination after a pass that only removed imports. Removing an import
cannot make another declaration unused, so the extra traversal and scope crawl
are skipped. Bare side-effect imports are kept.
