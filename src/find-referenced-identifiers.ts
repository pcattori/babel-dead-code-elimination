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

  traverse(ast, {
    ImportDeclaration(path) {
      for (let specifier of path.get("specifiers")) {
        let local = specifier.get("local")
        if (Identifier.isReferenced(local)) {
          referenced.add(local)
        }
      }
    },
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
  })
  return referenced
}
