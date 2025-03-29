import { describe, expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import ts from "dedent"
import * as prettier from "prettier"

import { traverse } from "./babel-esm"
import deadCodeElimination from "./dead-code-elimination"
import findReferencedIdentifiers from "./find-referenced-identifiers"

async function format(source: string): Promise<string> {
  return prettier.format(source, { parser: "babel", semi: false })
}

let DECLARATIONS = ["var", "const", "let"]

let dce = async (source: string): Promise<string> => {
  let ast = parse(source, { sourceType: "module" })
  deadCodeElimination(ast)
  return format(generate(ast).code)
}

describe("import", () => {
  test("side-effect", async () => {
    let source = ts`
      import "side-effect"
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import "side-effect"
      "
    `)
  })

  test("named", async () => {
    let source = ts`
      import { a, _b } from "named"
      import { _c } from "named-unused"
      ref(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import { a } from "named"
      ref(a)
      "
    `)
  })

  test("default", async () => {
    let source = ts`
      import a from "default-used"
      import _b from "default-unused"
      ref(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import a from "default-used"
      ref(a)
      "
    `)
  })

  test("namespace", async () => {
    let source = ts`
      import * as a from "namespace-used"
      import * as _b from "namespace-unused"
      ref(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import * as a from "namespace-used"
      ref(a)
      "
    `)
  })
})

describe("function", () => {
  test("declaration", async () => {
    let source = ts`
      export function a() {
        return
      }
      function _b() {
        return
      }
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "export function a() {
        return
      }
      "
    `)
  })

  test("expression", async () => {
    let source = ts`
      let _a = function () {
        return
      }
      let a = function () {
        return
      }
      ref(a)
      ref(function () {})
      ref(function named() {})
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "let a = function () {
        return
      }
      ref(a)
      ref(function () {})
      ref(function named() {})
      "
    `)
  })

  test("arrow", async () => {
    let source = ts`
      let _a = () => {}
      let a = () => {}
      ref(a)
      ref(() => {})
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "let a = () => {}
      ref(a)
      ref(() => {})
      "
    `)
  })
})

describe("variable", () => {
  test("identifier", async () => {
    let source = ts`
      let _x = 1
      let x = 1
      ref(x)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "let x = 1
      ref(x)
      "
    `)
  })

  DECLARATIONS.forEach((decl) => {
    test(`within for...in: ${decl}`, async () => {
      let source = `for (${decl} a in b) {}`
      expect(await dce(source)).toMatchInlineSnapshot(`
        "for (${decl} a in b) {
        }
        "
      `)
    })
  })

  DECLARATIONS.forEach((decl) => {
    test(`within for...of: ${decl}`, async () => {
      let source = `for (${decl} a of b) {}`

      expect(await dce(source)).toMatchInlineSnapshot(`
        "for (${decl} a of b) {
        }
        "
      `)
    })
  })

  describe("object pattern", () => {
    test("preserves unused variables when rest is used", async () => {
      let source = ts`
        let { _a, ...rest } = x
        ref(rest)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let { _a, ...rest } = x
        ref(rest)
        "
      `)
    })

    test("only eliminates candidates", async () => {
      let source = ts`
        let { alwaysUnreferenced, newlyUnreferenced, alwaysReferenced } = x
        ref(alwaysReferenced)
        export default newlyUnreferenced
      `
      let ast = parse(source, { sourceType: "module" })
      let referenced = findReferencedIdentifiers(ast)
      traverse(ast, {
        ExportDefaultDeclaration(path) {
          path.remove()
        },
      })
      deadCodeElimination(ast, referenced)
      expect(await format(generate(ast).code)).toMatchInlineSnapshot(`
        "let { alwaysUnreferenced, alwaysReferenced } = x
        ref(alwaysReferenced)
        "
      `)
    })

    test("within variable declarator", async () => {
      let source = ts`
        let { _a, a } = x
        ref(a)
        let {..._rest} = x
        let {...rest} = x
        ref(rest)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let { a } = x
        ref(a)
        let { ...rest } = x
        ref(rest)
        "
      `)
    })

    test("within object property", async () => {
      let source = ts`
        let { a: { _aa, aa, ..._rest } } = x
        ref(aa)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let {
          a: { aa },
        } = x
        ref(aa)
        "
      `)
    })

    test("within array pattern", async () => {
      let source = ts`
        let { a: [{ _aa, aa, ..._rest }] } = x
        ref(aa)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let {
          a: [{ aa }],
        } = x
        ref(aa)
        "
      `)
    })

    describe("within assignment pattern", () => {
      test("within object property", async () => {
        let source = ts`
          let { a: { _aa, aa, ..._rest }={ aa: 1 } } = x
          ref(aa)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "let {
            a: { aa } = {
              aa: 1,
            },
          } = x
          ref(aa)
          "
        `)
      })

      test("within array pattern", async () => {
        let source = ts`
          let { a: [{ _aa, aa, ...rest }={ aa: 1 }] } = x
          ref(aa)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "let {
            a: [
              { aa } = {
                aa: 1,
              },
            ],
          } = x
          ref(aa)
          "
        `)
      })
    })

    test("within rest element", async () => {
      let source = ts`
        let [...{ _a, a, ..._rest }] = x
        ref(a)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let [...{ a }] = x
        ref(a)
        "
      `)
    })

    describe("within function param", () => {
      test("within function declaration", async () => {
        let source = ts`
          function f(a, {}) { return a; }
          ref(f)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "function f(a, {}) {
            return a
          }
          ref(f)
          "
        `)
      })

      test("within function expression", async () => {
        let source = ts`
          const f = function(a, {}) { return a }
          ref(f)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "const f = function (a, {}) {
            return a
          }
          ref(f)
          "
        `)
      })

      test("within object method", async () => {
        let source = ts`
          const a = {
            f(a, {}) { return a }
          }
          ref(a.f)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "const a = {
            f(a, {}) {
              return a
            },
          }
          ref(a.f)
          "
        `)
      })

      test("within arrow function expression", async () => {
        let source = ts`
          let f = (a, {}) => a
          ref(f)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "let f = (a, {}) => a
          ref(f)
          "
        `)
      })

      test("within class method", async () => {
        let source = ts`
          class A {
            f(a, {}) { return a }
          }
          ref(A)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "class A {
            f(a, {}) {
              return a
            }
          }
          ref(A)
          "
        `)
      })

      test("within class private method", async () => {
        let source = ts`
          class A {
            #f(a, {}) { return a }
          }
          ref(A)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "class A {
            #f(a, {}) {
              return a
            }
          }
          ref(A)
          "
        `)
      })
    })

    test("unzips if all variables are unused", async () => {
      let source = ts`
        let {
          _a, // Identifier
          _b: {_bb, ..._brest}, // within ObjectProperty
          _c: [{_cc, ..._crest}], // within ArrayPattern
          _d: {_dd, ..._drest} = {}, // within AssignmentPattern within ObjectProperty
          _e: [{_ee, ..._erest}={}], // within AssignmentPattern within ArrayPattern
          _f: [...{_ff, ..._frest}], // within RestElement
          ..._g // RestElement
        } = _x
      `
      expect(await dce(source)).toMatchInlineSnapshot(`""`)
    })
  })

  describe("array pattern", () => {
    test("within variable declarator", async () => {
      let source = ts`
        let [ _a0, a1, _a2, a3, _a4 ] = x
        ref(a1, a3)
        let [..._rest] = x
        let [...rest] = x
        ref(rest)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let [, a1, , a3, ,] = x
        ref(a1, a3)
        let [...rest] = x
        ref(rest)
        "
      `)
    })

    test("within object property", async () => {
      let source = ts`
        let { a: [ _aa, aa, ..._rest ] } = x
        ref(aa)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let {
          a: [, aa],
        } = x
        ref(aa)
        "
      `)
    })

    test("within array pattern", async () => {
      let source = ts`
        let [[ _aa, aa, ..._rest ]] = x
        ref(aa)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let [[, aa]] = x
        ref(aa)
        "
      `)
    })

    describe("within assignment pattern", () => {
      test("within object property", async () => {
        let source = ts`
          let { a: { _aa, aa, ..._rest }={ aa: 1 } } = x
          ref(aa)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "let {
            a: { aa } = {
              aa: 1,
            },
          } = x
          ref(aa)
          "
        `)
      })

      test("within array pattern", async () => {
        let source = ts`
          let [{ _a, a, ...rest }={ a: 1 }] = x
          ref(a)
        `
        expect(await dce(source)).toMatchInlineSnapshot(`
          "let [
            { a } = {
              a: 1,
            },
          ] = x
          ref(a)
          "
        `)
      })
    })

    test("within rest element", async () => {
      let source = ts`
        let [...[ _a, a, ..._rest ]] = x
        ref(a)
      `
      expect(await dce(source)).toMatchInlineSnapshot(`
        "let [...[, a]] = x
        ref(a)
        "
      `)
    })

    test("unzips if all variables are unused", async () => {
      let source = ts`
        let [
          _a, // Identifier
          {_b, ..._brest}, // within ObjectProperty
          [{_c, ..._crest}], // within ArrayPattern
          {_d, ..._drest} = {}, // within AssignmentPattern within ObjectProperty
          [{_e, ..._erest}={}], // within AssignmentPattern within ArrayPattern
          [...{_f, ..._frest}], // within RestElement
          ..._g // RestElement
        ] = _x
      `
      expect(await dce(source)).toMatchInlineSnapshot(`""`)
    })
  })
})

test("assignment", async () => {
  let source = ts`
    let x = 1
    x = 2
  `
  expect(await dce(source)).toMatchInlineSnapshot(`
    "let x = 1
    x = 2
    "
  `)
})

test("repeated elimination", async () => {
  let source = ts`
    import { a } from "named"
    import b from "default"
    import * as c from "namespace"

    function d() {
      return [a, b, c]
    }

    let e = function () {
      return d()
    }

    let f = () => {
      return e()
    }

    let g = f()
    let [h] = g
    let { i } = g

    export let j = "j"
    ref("k")
  `
  expect(await dce(source)).toMatchInlineSnapshot(`
    "export let j = "j"
    ref("k")
    "
  `)
})

test("only eliminates newly unreferenced identifiers", async () => {
  let source = ts`
    let alwaysUnreferenced = 1

    let newlyUnreferenced = 2
    export default newlyUnreferenced

    let alwaysReferenced = 3
    ref(alwaysReferenced)
  `

  let ast = parse(source, { sourceType: "module" })
  let referenced = findReferencedIdentifiers(ast)
  traverse(ast, {
    ExportDefaultDeclaration(path) {
      path.remove()
    },
  })
  deadCodeElimination(ast, referenced)
  expect(await format(generate(ast).code)).toMatchInlineSnapshot(`
    "let alwaysUnreferenced = 1
    let alwaysReferenced = 3
    ref(alwaysReferenced)
    "
  `)
})
