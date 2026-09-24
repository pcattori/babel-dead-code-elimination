import { readFileSync } from "node:fs"
import generate from "@babel/generator"
import type { Visitor } from "@babel/traverse"

import {
  parse,
  traverse,
  t,
  type Babel,
  type NodePath,
  type ParseResult,
} from "../src/babel-esm"
import {
  collectReferencedIdentifiers,
  deadCodeElimination,
  findReferencedIdentifiers,
} from "../src/index"

// Shared workloads for benchmarks/*.bench.ts and the corpus parity test.
//
// kind "drop":      replace DROP(x) calls with 0 (synthetic modules)
// kind "rr":        React Router: remove loader/action/headers/middleware exports
// kind "tsr":       TanStack Start: replace createServerFn().handler(fn) with an RPC stub
// kind "tsr-split": "tsr" plus TanStack Router route component code splitting
export type Kind = "drop" | "rr" | "tsr" | "tsr-split"
export type Workload = { name: string; kind: Kind; code: string }

const repeat = (count: number, line: (i: number) => string) =>
  Array.from({ length: count }, (_, i) => line(i)).join("\n")

export const ordinary = (count: number) =>
  repeat(
    count,
    (i) =>
      `export function ordinary${i}(value) { const data = { value: value.trim(), count: ${i} }; return { label: data.value.toUpperCase(), score: data.count * 2 }; }`,
  )
export const schema = (count: number) =>
  `const schema = value => value.trim(); export const answer = DROP(schema);\n${ordinary(count)}`
export const chain = (count: number) =>
  `const value0 = () => 42;\n${repeat(count, (i) => `const value${i + 1} = value${i};`)}\nexport const answer = DROP(value${count});`
export const registry = (count: number, references: number) =>
  `${repeat(count, (i) => `const value${i} = ${i};`)}\nexport function collect() { return [${Array.from({ length: count }, (_, i) => Array(references).fill(`value${i}`).join(",")).join(",")}]; }`
export const imports = (count: number) =>
  `import 'setup';\n${repeat(count, (i) => `import { value as v${i} } from 'pkg${i}';`)}\nexport const answer = DROP([${Array.from({ length: count }, (_, i) => `v${i}`).join(",")}]);\n${ordinary(40)}`
export const patterns = (count: number) =>
  repeat(
    count,
    (i) =>
      `export function select${i}({ a, nested: { b }, ...rest }, [first, ...tail]) { return [a, b, rest, first, tail]; }\nconst { omit${i}, keep${i}, ...rest${i} } = source; export const out${i} = rest${i}; export const drop${i} = DROP([omit${i}, keep${i}]);`,
  )

const corpusFile = (name: string) =>
  readFileSync(new URL(`./corpus/${name}.tsx`, import.meta.url), "utf8")

export const realistic: Workload[] = [
  { name: "rr-small", kind: "rr", code: corpusFile("rr-small") },
  { name: "rr-project", kind: "rr", code: corpusFile("rr-project") },
  { name: "rr-settings", kind: "rr", code: corpusFile("rr-settings") },
  { name: "tsr-posts", kind: "tsr", code: corpusFile("tsr-posts") },
  { name: "tsr-admin", kind: "tsr", code: corpusFile("tsr-admin") },
  { name: "tsr-admin-split", kind: "tsr-split", code: corpusFile("tsr-admin") },
]

export const synthetic: Workload[] = [
  { name: "schema-80", kind: "drop", code: schema(80) },
  { name: "chain-24", kind: "drop", code: chain(24) },
  { name: "chain-96", kind: "drop", code: chain(96) },
  { name: "ordinary-200", kind: "drop", code: ordinary(200) },
  { name: "imports-64", kind: "drop", code: imports(64) },
  { name: "patterns-40", kind: "drop", code: patterns(40) },
  {
    name: "tiny",
    kind: "drop",
    code: "const value = 42; export const answer = DROP(value);",
  },
]

export const workloads = [...realistic, ...synthetic]

export const parseWorkload = (workload: Workload): ParseResult<Babel.File> =>
  parse(workload.code, {
    sourceType: "module",
    sourceFilename: `${workload.name}.tsx`,
    plugins: workload.kind === "drop" ? [] : ["jsx", "typescript"],
  })

const SERVER_EXPORTS = new Set(["loader", "action", "headers", "middleware"])
const SPLIT_KEYS = new Set([
  "component",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
])

type Edits = { paths: NodePath[]; split: NodePath<Babel.CallExpression>[] }

function rootCallee(node: Babel.Node | null | undefined): string | null {
  while (node) {
    if (t.isCallExpression(node)) {
      if (t.isIdentifier(node.callee)) return node.callee.name
      node = node.callee
    } else if (t.isMemberExpression(node)) node = node.object
    else return null
  }
  return null
}

/** A read-only analysis visitor that records the paths the transform edits. */
export function analysisVisitor(kind: Kind, edits: Edits): Visitor {
  if (kind === "drop") {
    return {
      CallExpression(path) {
        if (t.isIdentifier(path.node.callee, { name: "DROP" })) {
          edits.paths.push(path)
        }
      },
    }
  }
  if (kind === "rr") {
    return {
      ExportNamedDeclaration(path) {
        let declaration = path.node.declaration
        if (!declaration) {
          for (let specifier of path.get("specifiers")) {
            let exported = specifier.node.exported
            let name = t.isIdentifier(exported) ? exported.name : exported.value
            if (SERVER_EXPORTS.has(name)) edits.paths.push(specifier)
          }
        } else if (t.isFunctionDeclaration(declaration)) {
          if (declaration.id && SERVER_EXPORTS.has(declaration.id.name)) {
            edits.paths.push(path)
          }
        } else if (t.isVariableDeclaration(declaration)) {
          let declarations = path.get("declaration.declarations")
          for (let declarator of declarations as NodePath<Babel.VariableDeclarator>[]) {
            let id = declarator.node.id
            if (t.isIdentifier(id) && SERVER_EXPORTS.has(id.name)) {
              edits.paths.push(declarator)
            }
          }
        }
      },
    }
  }
  return {
    CallExpression(path) {
      let callee = path.node.callee
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.property, { name: "handler" }) &&
        rootCallee(callee.object) === "createServerFn"
      ) {
        edits.paths.push(path)
      } else if (
        kind === "tsr-split" &&
        t.isCallExpression(callee) &&
        t.isIdentifier(callee.callee, { name: "createFileRoute" })
      ) {
        edits.split.push(path)
      }
    },
  }
}

/** Applies the edits recorded by analysisVisitor. */
export function applyEdits(kind: Kind, edits: Edits): void {
  if (kind === "drop") {
    for (let path of edits.paths) path.replaceWith(t.numericLiteral(0))
    return
  }
  if (kind === "rr") {
    for (let path of edits.paths) if (!path.removed) path.remove()
    return
  }
  edits.paths.forEach((path, i) => {
    ;(path.get("arguments.0") as NodePath).replaceWith(
      t.callExpression(t.identifier("createClientRpc"), [
        t.stringLiteral(`fn_${i}`),
      ]),
    )
  })
  for (let path of edits.split) {
    let options = path.get("arguments.0") as NodePath<Babel.ObjectExpression>
    for (let property of options.get("properties")) {
      if (
        property.isObjectProperty() &&
        t.isIdentifier(property.node.key) &&
        SPLIT_KEYS.has(property.node.key.name)
      ) {
        property
          .get("value")
          .replaceWith(
            t.callExpression(t.identifier("lazyRouteComponent"), [
              t.identifier("$$splitComponentImporter"),
              t.stringLiteral(property.node.key.name),
            ]),
          )
      }
    }
  }
}

const newEdits = (): Edits => ({ paths: [], split: [] })

export type Mode = "default" | "collector"

/** The consumer pipeline: parse, reference analysis, transform, DCE, generate. */
export function pipeline(workload: Workload, mode: Mode) {
  let ast = parseWorkload(workload)
  let edits = newEdits()
  let referenced
  if (mode === "default") {
    referenced = findReferencedIdentifiers(ast)
    traverse(ast, analysisVisitor(workload.kind, edits))
  } else {
    let readReferences = collectReferencedIdentifiers(ast, {
      visitor: analysisVisitor(workload.kind, edits),
    })
    referenced = readReferences()
  }
  applyEdits(workload.kind, edits)
  deadCodeElimination(ast, referenced)
  return generate(
    ast,
    { sourceMaps: true, sourceFileName: `${workload.name}.tsx` },
    workload.code,
  )
}

/** An AST after reference analysis and the transform, ready for DCE. */
export function prepareElimination(workload: Workload) {
  let ast = parseWorkload(workload)
  let referenced = findReferencedIdentifiers(ast)
  let edits = newEdits()
  traverse(ast, analysisVisitor(workload.kind, edits))
  applyEdits(workload.kind, edits)
  return { ast, referenced }
}
