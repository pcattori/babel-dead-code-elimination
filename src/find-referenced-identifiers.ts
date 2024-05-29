import {
  traverse,
  type NodePath,
  type BabelTypes,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"

export default function (
  ast: ParseResult<BabelTypes.File>
): Set<Identifier.Path> {
  const referenced = new Set<Identifier.Path>()

  function markFunction(
    path: NodePath<
      | BabelTypes.FunctionDeclaration
      | BabelTypes.FunctionExpression
      | BabelTypes.ArrowFunctionExpression
    >
  ) {
    const ident = Identifier.fromFunction(path)
    if (ident?.node && Identifier.isReferenced(ident)) {
      referenced.add(ident)
    }
  }

  function markImport(
    path: NodePath<
      | BabelTypes.ImportSpecifier
      | BabelTypes.ImportDefaultSpecifier
      | BabelTypes.ImportNamespaceSpecifier
    >
  ) {
    const local = path.get("local")
    if (Identifier.isReferenced(local)) {
      referenced.add(local)
    }
  }

  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.type === "Identifier") {
        const local = path.get("id") as NodePath<BabelTypes.Identifier>
        if (Identifier.isReferenced(local)) {
          referenced.add(local)
        }
      } else if (path.node.id.type === "ObjectPattern") {
        const pattern = path.get("id") as NodePath<BabelTypes.ObjectPattern>

        const properties = pattern.get("properties")
        properties.forEach((p) => {
          const local = p.get(
            p.node.type === "ObjectProperty"
              ? "value"
              : p.node.type === "RestElement"
              ? "argument"
              : (function () {
                  throw new Error("invariant")
                })()
          ) as NodePath<BabelTypes.Identifier>
          if (Identifier.isReferenced(local)) {
            referenced.add(local)
          }
        })
      } else if (path.node.id.type === "ArrayPattern") {
        const pattern = path.get("id") as NodePath<BabelTypes.ArrayPattern>

        const elements = pattern.get("elements")
        elements.forEach((e) => {
          let local: NodePath<BabelTypes.Identifier>
          if (e.node?.type === "Identifier") {
            local = e as NodePath<BabelTypes.Identifier>
          } else if (e.node?.type === "RestElement") {
            local = e.get("argument") as NodePath<BabelTypes.Identifier>
          } else {
            return
          }

          if (Identifier.isReferenced(local)) {
            referenced.add(local)
          }
        })
      }
    },

    FunctionDeclaration: markFunction,
    FunctionExpression: markFunction,
    ArrowFunctionExpression: markFunction,
    ImportSpecifier: markImport,
    ImportDefaultSpecifier: markImport,
    ImportNamespaceSpecifier: markImport,
  })
  return referenced
}
