import {
  traverse,
  type NodePath,
  type Babel,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"
import * as Pattern from "./pattern"

export default function (
  ast: ParseResult<Babel.File>,
): Set<NodePath<Babel.Identifier>> {
  const referenced = new Set<NodePath<Babel.Identifier>>()

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
      let id = path.get("id")
      if (id.isIdentifier()) {
        if (Identifier.isReferenced(id)) {
          referenced.add(id)
        }
      } else if (id.isObjectPattern() || id.isArrayPattern()) {
        for (let variable of Pattern.findVariables(id)) {
          if (Identifier.isReferenced(variable)) {
            referenced.add(variable)
          }
        }
      }
    },

    FunctionDeclaration(path) {
      let id = path.get("id")
      if (id.isIdentifier() && Identifier.isReferenced(id)) {
        referenced.add(id)
      }
    },
    ImportSpecifier: markImport,
    ImportDefaultSpecifier: markImport,
    ImportNamespaceSpecifier: markImport,
  })
  return referenced
}
