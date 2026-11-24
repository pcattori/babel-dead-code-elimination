// Compares two benchmark reports written by `vitest bench --reporter=json`:
// node benchmarks/compare.mjs <baseline.json> <change.json>
// Prints each benchmark's mean time and the change/baseline ratio, then the
// geometric mean of the ratios per benchmark file.
import { readFileSync } from "node:fs"
import { basename } from "node:path"

const means = (file) => {
  const report = JSON.parse(readFileSync(file, "utf8"))
  const result = new Map()
  for (const entry of report.testResults) {
    for (const test of entry.assertionResults) {
      for (const group of test.benchmarks ?? []) {
        for (const task of group.tasks) {
          result.set(
            `${basename(entry.name)} > ${group.name}`,
            task.latency.mean,
          )
        }
      }
    }
  }
  return result
}

const [base, change] = process.argv.slice(2).map(means)
const ratios = new Map()
for (const [name, before] of base) {
  const after = change.get(name)
  if (after === undefined) continue
  const ratio = after / before
  const file = name.split(" > ")[0]
  ratios.set(file, [...(ratios.get(file) ?? []), ratio])
  console.log(
    `${name}: ${before.toFixed(4)} ms -> ${after.toFixed(4)} ms (${ratio.toFixed(2)}x)`,
  )
}
for (const [file, values] of ratios) {
  const geomean = Math.exp(
    values.reduce((sum, r) => sum + Math.log(r), 0) / values.length,
  )
  console.log(
    `${file}: geometric mean ${geomean.toFixed(3)}x over ${values.length}`,
  )
}
