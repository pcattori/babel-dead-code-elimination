import { expect, test } from "vitest"
import dedent from "dedent"
import { parse } from "@babel/parser"
import { Babel, traverse, type NodePath } from "./babel-esm"
import findRemovableBindings from "./find-removable-bindings"

const findRemovableNames = (source: string): string[] => {
  let ast = parse(source, { sourceType: "module" })
  let progPath: NodePath<Babel.Program> | null = null
  traverse(ast, {
    Program(path) {
      progPath = path
      path.stop()
    },
  })
  if (!progPath) return []
  return Array.from(findRemovableBindings(progPath)).map(
    (b) => b.identifier.name,
  )
}

test("mutual recursion without external refs -> removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return a() }
  `
  let names = findRemovableNames(source)
  // both 'a' and 'b' should be removable as they only reference each other
  expect(names.sort()).toEqual(["a", "b"].sort())
})

test("mutual recursion with external ref -> not removable", () => {
  let source = dedent`
    function a() { return b() }
    export function b() { return a() }
    ref(b)
  `
  let names = findRemovableNames(source)
  // since b is referenced externally, none should be removable
  expect(names).toEqual([])
})

test("self recursive function unused -> removable", () => {
  let source = dedent`
    function a() { return a() }
  `
  let names = findRemovableNames(source)
  expect(names).toEqual(["a"])
})

test("imports are not considered removable", () => {
  let source = dedent`
    import a from "pkg"
    import { b } from "pkg"
  `
  let names = findRemovableNames(source)
  expect(names).toEqual([])
})

test("exports are not considered removable", () => {
  let source = dedent`
    export const a = 1
    export function b() { return 2 }
  `
  let names = findRemovableNames(source)
  expect(names).toEqual([])
})

test("mutual recursion with one function exported -> not removable", () => {
  let source = dedent`
    function y () { return x() }
    export function x() { return y() }
  `
  let names = findRemovableNames(source)
  expect(names).toEqual([])
})

// === SCC edge cases ===

test("n=0: all bindings externally used -> none removable", () => {
  let source = dedent`
    const a = 1
    const b = 2
    ref(a, b)
  `
  let names = findRemovableNames(source)
  expect(names).toEqual([])
})

test("n=2: one self-ref, one not -> only self-ref removable", () => {
  let source = dedent`
    function a() { return a() }
    function b() { return 1 }
    ref(b)
  `
  let names = findRemovableNames(source)
  expect(names).toEqual(["a"])
})

test("n=2: no cycle between two -> callee of dead code removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return 1 }
  `
  let names = findRemovableNames(source)
  // only the unreferenced (and so dead) `a` references `b`
  expect(names).toEqual(["b"])
})

test("n=3: triangle cycle -> all removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return c() }
    function c() { return a() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b", "c"])
})

test("n=3: linear chain no cycle -> everything dead code reaches is removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return c() }
    function c() { return 1 }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["b", "c"])
})

test("n=3: A↔B mutual, A→C (C unused) -> A-B-C removable", () => {
  // A and B reference each other, A also calls C, but C is not in cycle
  let source = dedent`
    function a() { b(); c() }
    function b() { return a() }
    function c() { return 1 }
  `
  let names = findRemovableNames(source)
  // nothing outside A, B and C references them
  expect(names.sort()).toEqual(["a", "b", "c"])
})

test("n=3: A↔B mutual, C→A (C unused) -> A-B removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return a() }
    function c() { return a() }
  `
  let names = findRemovableNames(source)
  // only the unreferenced (and so dead) C references the cycle
  expect(names.sort()).toEqual(["a", "b"])
})

test("n=3: A↔B mutual, C→B (C unused) -> A-B removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return a() }
    function c() { return b() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b"])
})

test("n=3: three independent self-refs -> all removable", () => {
  let source = dedent`
    function a() { return a() }
    function b() { return b() }
    function c() { return c() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b", "c"])
})

test("n=3: A→A self, B↔C mutual -> all removable", () => {
  let source = dedent`
    function a() { return a() }
    function b() { return c() }
    function c() { return b() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b", "c"])
})

test("n=3: A→B, B→C, no cycle -> B-C removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return c() }
    function c() { return 1 }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["b", "c"])
})

test("n=3: reverse triangle A←B←C←A -> all removable", () => {
  let source = dedent`
    function a() { return c() }
    function b() { return a() }
    function c() { return b() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b", "c"])
})

test("n=4: two separate SCCs -> both cycles removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return a() }
    function c() { return d() }
    function d() { return c() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b", "c", "d"])
})

test("n=4: SCC with incoming from external binding -> none removable", () => {
  // c is externally used, so c must be kept. c calls a, so a must be kept.
  // a calls b and b calls a, so b must be kept too.
  let source = dedent`
    function a() { return b() }
    function b() { return a() }
    function c() { return a() }
    ref(c)
  `
  let names = findRemovableNames(source)
  // c is used externally, so a-b cannot be removed (c depends on a)
  expect(names).toEqual([])
})

test("SCC with incoming only from dead code -> removable", () => {
  // c->a, but c itself is unreferenced, so nothing live reaches a-b
  let source = dedent`
    function a() { return b() }
    function b() { return a() }
    function c() { return a() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b"])
})

test("mixed: self-only + cycle + external", () => {
  let source = dedent`
    function selfOnly() { return selfOnly() }
    function cycleA() { return cycleB() }
    function cycleB() { return cycleA() }
    function external() { return 1 }
    ref(external)
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["cycleA", "cycleB", "selfOnly"])
})

test("large cycle (5 nodes) -> all removable", () => {
  let source = dedent`
    function a() { return b() }
    function b() { return c() }
    function c() { return d() }
    function d() { return e() }
    function e() { return a() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b", "c", "d", "e"])
})

test("cycle with self-loop inside -> removable", () => {
  let source = dedent`
    function a() { a(); return b() }
    function b() { return a() }
  `
  let names = findRemovableNames(source)
  expect(names.sort()).toEqual(["a", "b"])
})

test("constant violations mark as external", () => {
  let source = dedent`
    let a = 1
    a = 2
  `
  let names = findRemovableNames(source)
  expect(names).toEqual([])
})

test("empty program -> no removable", () => {
  let source = ``
  let names = findRemovableNames(source)
  expect(names).toEqual([])
})

test("single unreferenced binding without self-ref -> not removable by SCC", () => {
  // This is an important edge case: a binding with 0 references
  // is NOT a cycle, so SCC logic shouldn't mark it removable
  // (DCE removes it via different logic - unused variable)
  let source = dedent`
    const unused = 1
  `
  let names = findRemovableNames(source)
  expect(names).toEqual([])
})
