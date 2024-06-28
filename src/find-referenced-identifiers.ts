import {
  traverse,
  type NodePath,
  type Babel,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"

export default function (
  ast: ParseResult<Babel.File>,
): Set<NodePath<Babel.Identifier>> {
  const referenced = new Set<NodePath<Babel.Identifier>>()

  function markFunction(
    path: NodePath<
      | Babel.FunctionDeclaration
      | Babel.FunctionExpression
      | Babel.ArrowFunctionExpression
    >,
  ) {
    const ident = Identifier.fromFunction(path)
    if (ident?.node && Identifier.isReferenced(ident)) {
      referenced.add(ident)
    }
  }

  function markImport(
    path: NodePath<
      | Babel.ImportSpecifier
      | Babel.ImportDefaultSpecifier
      | Babel.ImportNamespaceSpecifier
    >,
  ) {
    const local = path.get("local")
    if (Identifier.isReferenced(local)) {
      referenced.add(local)
    }
  }

  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.type === "Identifier") {
        const local = path.get("id") as NodePath<Babel.Identifier>
        if (Identifier.isReferenced(local)) {
          referenced.add(local)
        }
      } else if (path.node.id.type === "ObjectPattern") {
        const pattern = path.get("id") as NodePath<Babel.ObjectPattern>

        const properties = pattern.get("properties")
        properties.forEach((p) => {
          const local = p.get(
            p.node.type === "ObjectProperty"
              ? "value"
              : p.node.type === "RestElement"
                ? "argument"
                : (function () {
                    throw new Error("invariant")
                  })(),
          ) as NodePath<Babel.Identifier>
          if (Identifier.isReferenced(local)) {
            referenced.add(local)
          }
        })
      } else if (path.node.id.type === "ArrayPattern") {
        const pattern = path.get("id") as NodePath<Babel.ArrayPattern>

        const elements = pattern.get("elements")
        elements.forEach((e) => {
          let local: NodePath<Babel.Identifier>
          if (e.node?.type === "Identifier") {
            local = e as NodePath<Babel.Identifier>
          } else if (e.node?.type === "RestElement") {
            local = e.get("argument") as NodePath<Babel.Identifier>
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
