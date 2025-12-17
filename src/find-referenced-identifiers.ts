import {
  traverse,
  type NodePath,
  type Babel,
  type ParseResult,
  type Binding,
} from "./babel-esm"
import * as Pattern from "./pattern"
import findRemovableBindings from "./find-removable-bindings"

/** Check if binding is referenced and not removable, then add to set */
function addIfReferenced(
  ident: NodePath<Babel.Identifier>,
  removable: Set<Binding>,
  referenced: Set<NodePath<Babel.Identifier>>,
): void {
  const binding = ident.scope.getBinding(ident.node.name)
  if (binding && !removable.has(binding) && binding.referenced) {
    referenced.add(ident)
  }
}

export default function (
  ast: ParseResult<Babel.File>,
): Set<NodePath<Babel.Identifier>> {
  const referenced = new Set<NodePath<Babel.Identifier>>()
  let removable: Set<Binding>

  traverse(ast, {
    Program(path) {
      path.scope.crawl()
      removable = findRemovableBindings(path)
    },
    ImportDeclaration(path) {
      for (const specifier of path.get("specifiers")) {
        addIfReferenced(specifier.get("local"), removable, referenced)
      }
    },
    VariableDeclarator(path) {
      const id = path.get("id")
      if (id.isIdentifier()) {
        addIfReferenced(id, removable, referenced)
      } else if (id.isObjectPattern() || id.isArrayPattern()) {
        for (const variable of Pattern.findVariables(id)) {
          addIfReferenced(variable, removable, referenced)
        }
      }
    },
    FunctionDeclaration(path) {
      const id = path.get("id")
      if (id.isIdentifier()) {
        addIfReferenced(id, removable, referenced)
      }
    },
  })

  return referenced
}
