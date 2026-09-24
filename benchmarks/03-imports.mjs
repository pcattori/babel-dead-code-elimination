import { dce, pipeline, ordinary, repeat } from "./cases.mjs"
const realistic = `import 'setup'; import { schema } from 'schema'; export const answer=DROP(schema);\n${ordinary(40)}`
export default [
  dce("stripped-schema-import", realistic),
  dce(
    "64-imports-amid-live-code",
    `import 'setup';\n${repeat(64, (i) => `import { value as v${i} } from 'pkg${i}';`)}\nexport const answer=DROP([${Array.from({ length: 64 }, (_, i) => `v${i}`).join(",")}]);\n${ordinary(40)}`,
  ),
  dce(
    "variable-to-import-cascade",
    `import 'setup'; import { schema } from 'schema'; const first=schema; const second=first; export const answer=DROP(second);\n${ordinary(20)}`,
  ),
  dce(
    "all-imports-live-control",
    `import 'setup'; import { schema } from 'schema'; export const answer=schema;\n${ordinary(40)}`,
  ),
  dce(
    "bare-imports-control",
    repeat(12, (i) => `import 'setup${i}';`),
  ),
  pipeline("stripped-schema-end-to-end", realistic),
]
