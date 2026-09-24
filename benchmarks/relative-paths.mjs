// Vitest writes absolute file paths into --outputJson reports. Store them
// relative to the working directory so that a committed report is portable.
import { readFileSync, writeFileSync } from "node:fs"
import { relative } from "node:path"

const file = process.argv[2]
const report = JSON.parse(readFileSync(file, "utf8"))
for (const entry of report.files) {
  entry.filepath = relative(process.cwd(), entry.filepath)
}
writeFileSync(file, JSON.stringify(report, null, 2) + "\n")
