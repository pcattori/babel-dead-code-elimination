import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { cpus } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [group, beforeFile, afterFile, outputFile, flag] = process.argv.slice(2)
if (!outputFile) {
  throw new Error(
    "Usage: node --expose-gc paired.mjs GROUP BEFORE.mjs AFTER.mjs OUTPUT.json [--parity-only]",
  )
}
const cases = (await import(`./${group}.mjs`)).default
const variants = [
  await import(pathToFileURL(resolve(beforeFile))),
  await import(pathToFileURL(resolve(afterFile))),
]
const hash = (text) => createHash("sha256").update(text).digest("hex")
const names = ["before", "after"]
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p25Ms: sorted[Math.floor((sorted.length - 1) / 4)],
    p75Ms: sorted[Math.ceil(((sorted.length - 1) * 3) / 4)],
    samplesMs: values,
  }
}
const parse = (api, fixture) =>
  api.parse(fixture.code, {
    sourceType: "module",
    sourceFilename: `${fixture.name}.js`,
  })
const generate = (api, fixture, ast) => {
  const output = api.generate(
    ast,
    { sourceMaps: true, sourceFileName: `${fixture.name}.js` },
    fixture.code,
  )
  return { code: output.code, map: output.map }
}
const fingerprint = (set) =>
  [...(set ?? [])].map((value) => {
    const node = value.node ?? value.identifier
    return `${node.start}:${node.end}:${node.name}`
  })
function analyze(api, fixture, ast, after) {
  const calls = []
  const visitor = {
    CallExpression(path) {
      if (path.get("callee").isIdentifier({ name: "DROP" })) {
        calls.push(path)
      }
    },
  }
  let references
  const sharedTraversal =
    fixture.sharedTraversal || fixture.phase === "analysis"
  if (after && sharedTraversal) {
    const readReferences = api.collectReferencedIdentifiers(ast, {
      scopeIsFresh: !fixture.defaultRefresh,
      visitor,
    })
    if (calls.length) {
      references = readReferences()
    }
  } else {
    api.traverse(ast, visitor)
    const needsReferences =
      fixture.candidates !== "all" && (!sharedTraversal || calls.length > 0)
    if (needsReferences) {
      const reuseScopes =
        !fixture.defaultRefresh && (sharedTraversal || (after && fixture.optIn))
      references = api.findReferencedIdentifiers(
        ast,
        reuseScopes ? { scopeIsFresh: true } : undefined,
      )
    }
  }
  return { ast, references, calls }
}
function rewrite(api, state) {
  for (const call of state.calls) {
    call.replaceWith(api.t.numericLiteral(0))
  }
}
function prepare(api, fixture) {
  if (fixture.phase === "pipeline") {
    return undefined
  }
  const ast = parse(api, fixture)
  if (fixture.phase === "dce") {
    const state = analyze(api, fixture, ast, false)
    rewrite(api, state)
    return state
  }
  let program
  api.traverse(ast, {
    Program(path) {
      program = path
      path.stop()
    },
  })
  return { ast, program }
}
function operation(api, fixture, state, after) {
  if (fixture.phase === "graph") {
    return api.findRemovableBindings(state.program)
  }
  if (fixture.phase === "references") {
    return api.findReferencedIdentifiers(
      state.ast,
      after && fixture.optIn ? { scopeIsFresh: true } : undefined,
    )
  }
  if (fixture.phase === "analysis") {
    return analyze(api, fixture, state.ast, after)
  }
  if (fixture.phase === "dce") {
    api.deadCodeElimination(state.ast, state.references)
    return state.ast
  }
  const result = analyze(api, fixture, parse(api, fixture), after)
  if (!fixture.sharedTraversal || result.calls.length) {
    rewrite(api, result)
    api.deadCodeElimination(result.ast, result.references)
  }
  return generate(api, fixture, result.ast)
}
function observe(api, fixture, state, result) {
  if (fixture.phase === "graph" || fixture.phase === "references") {
    return fingerprint(result)
  }
  if (fixture.phase === "analysis") {
    return {
      references: fingerprint(result.references),
      callStarts: result.calls.map((path) => path.node.start),
    }
  }
  if (fixture.phase === "dce") {
    return generate(api, fixture, state.ast)
  }
  return result
}
const report = {
  group,
  node: process.version,
  cpu: cpus()[0].model,
  recordedAt: new Date().toISOString(),
  samples: Number(process.env.DCE_BENCH_SAMPLES ?? 9),
  warmups: Number(process.env.DCE_BENCH_WARMUPS ?? 32),
  before: { file: resolve(beforeFile), sha256: hash(readFileSync(beforeFile)) },
  after: { file: resolve(afterFile), sha256: hash(readFileSync(afterFile)) },
  fixtureSha256: hash(readFileSync(new URL(`./${group}.mjs`, import.meta.url))),
  protocol:
    "Fixed iterations per case; paired AB/BA batches; prepared scopes/reference snapshots/rewrites and GC outside timed primitive batches. Separate pipeline cases include parsing and generation. Graph-only cases reuse an immutable scoped AST; mutating operations use fresh ASTs. No cross-mechanism aggregate.",
  cases: [],
}
if (
  !Number.isInteger(report.samples) ||
  report.samples < 1 ||
  !Number.isInteger(report.warmups) ||
  report.warmups < 0
) {
  throw new Error(
    "DCE_BENCH_SAMPLES must be a positive integer; DCE_BENCH_WARMUPS must be a nonnegative integer",
  )
}
for (const fixture of cases) {
  const observations = variants.map((api, variant) => {
    const state = prepare(api, fixture)
    return observe(
      api,
      fixture,
      state,
      operation(api, fixture, state, variant === 1),
    )
  })
  assert.deepEqual(
    observations[1],
    observations[0],
    `${group}/${fixture.name}: output/map/path-membership parity`,
  )
}
console.log(JSON.stringify({ group, parity: "passed", cases: cases.length }))
if (flag === "--parity-only") {
  writeFileSync(
    outputFile,
    JSON.stringify({ ...report, parity: "passed" }, null, 2) + "\n",
  )
  process.exit(0)
}
if (!globalThis.gc) {
  throw new Error("Run with --expose-gc; GC must be outside batches")
}
for (const fixture of cases) {
  for (let warmup = 0; warmup < report.warmups; warmup++) {
    for (let variant = 0; variant < 2; variant++) {
      operation(
        variants[variant],
        fixture,
        prepare(variants[variant], fixture),
        variant === 1,
      )
    }
  }
  const times = [[], []]
  for (let sample = 0; sample < report.samples; sample++) {
    for (const variant of sample % 2 ? [1, 0] : [0, 1]) {
      const api = variants[variant]
      const states =
        fixture.phase === "graph"
          ? Array(fixture.iterations).fill(prepare(api, fixture))
          : Array.from({ length: fixture.iterations }, () =>
              prepare(api, fixture),
            )
      globalThis.gc()
      const start = performance.now()
      for (const state of states) {
        operation(api, fixture, state, variant === 1)
      }
      times[variant].push((performance.now() - start) / fixture.iterations)
    }
  }
  const [before, after] = times.map(stats)
  const result = {
    name: fixture.name,
    phase: fixture.phase,
    sourceBytes: Buffer.byteLength(fixture.code),
    sourceSha256: hash(fixture.code),
    iterations: fixture.iterations,
    before,
    after,
    pairedRatios: times[1].map((value, i) => value / times[0][i]),
    timeChangePercent: (after.medianMs / before.medianMs - 1) * 100,
    deltaMs: after.medianMs - before.medianMs,
  }
  report.cases.push(result)
  console.log(JSON.stringify(result))
}
writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n")
