import { describe, expect, test } from "vitest"
import { parse } from "@babel/parser"
import generate from "@babel/generator"
import dedent from "dedent"
import * as prettier from "prettier"

import { traverse } from "./babel-esm"
import deadCodeElimination from "./dead-code-elimination"
import findReferencedIdentifiers from "./find-referenced-identifiers"

async function format(source: string): Promise<string> {
  return prettier.format(source, { parser: "babel", semi: false })
}

let dce = async (source: string): Promise<string> => {
  let ast = parse(source, { sourceType: "module" })
  deadCodeElimination(ast)
  return format(generate(ast).code)
}

describe("import", () => {
  test("side-effect", async () => {
    let source = dedent`
      import "side-effect"
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import "side-effect"
      "
    `)
  })

  test("named", async () => {
    let source = dedent`
      import { a, _b } from "named"
      import { _c } from "named-unused"
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import { a } from "named"
      console.log(a)
      "
    `)
  })

  test("default", async () => {
    let source = dedent`
      import a from "default-used"
      import _b from "default-unused"
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import a from "default-used"
      console.log(a)
      "
    `)
  })

  test("namespace", async () => {
    let source = dedent`
      import * as a from "namespace-used"
      import * as _b from "namespace-unused"
      console.log(a)
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "import * as a from "namespace-used"
      console.log(a)
      "
    `)
  })
})

describe("function", () => {
  test("declaration", async () => {
    let source = dedent`
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
    let source = dedent`
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
    let source = dedent`
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
    let source = dedent`
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

  test("for...in statement", async () => {
    let source = dedent`
      for (var key in obj) {}
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "for (var key in obj) {
      }
      "
    `)
  })

  test("assignment within catch block", async () => {
    let source = dedent`
      export function a() {
        let aa = undefined;
        try {
          throw "";
        } catch {
          aa = 5;
        }
        return "";
      }
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "export function a() {
        let aa = undefined
        try {
          throw ""
        } catch {
          aa = 5
        }
        return ""
      }
      "
    `)
  })

  test("assignment within return statement", async () => {
    let source = dedent`
      let a
      export let b = {
        get c(){
          return (a ??= 1)
        }
      }
    `
    expect(await dce(source)).toMatchInlineSnapshot(`
      "let a
      export let b = {
        get c() {
          return (a ??= 1)
        },
      }
      "
    `)
  })

  describe("object pattern", () => {
    test("within variable declarator", async () => {
      let source = dedent`
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
      let source = dedent`
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
      let source = dedent`
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
        let source = dedent`
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
        let source = dedent`
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
      let source = dedent`
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
        let source = dedent`
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
        let source = dedent`
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
        let source = dedent`
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
        let source = dedent`
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
        let source = dedent`
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
        let source = dedent`
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
      let source = dedent`
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
      let source = dedent`
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
      let source = dedent`
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
      let source = dedent`
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
        let source = dedent`
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
        let source = dedent`
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
      let source = dedent`
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
      let source = dedent`
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

test("repeated elimination", async () => {
  let source = dedent`
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
    console.log("k")
  `
  expect(await dce(source)).toMatchInlineSnapshot(`
    "export let j = "j"
    console.log("k")
    "
  `)
})

test("only eliminates newly unreferenced identifiers", async () => {
  let source = dedent`
    let alwaysUnreferenced = 1

    let newlyUnreferenced = 2
    export default newlyUnreferenced

    let alwaysReferenced = 3
    console.log(alwaysReferenced)
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
    console.log(alwaysReferenced)
    "
  `)
})
