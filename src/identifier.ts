import { type NodePath, type Babel } from "./babel-esm"

export function fromFunction(
  path: NodePath<
    | Babel.FunctionDeclaration
    | Babel.FunctionExpression
    | Babel.ArrowFunctionExpression
  >,
): NodePath<Babel.Identifier> | null {
  let parentPath = path.parentPath
  if (parentPath.type === "VariableDeclarator") {
    let variablePath = parentPath as NodePath<Babel.VariableDeclarator>
    let name = variablePath.get("id")
    return name.node.type === "Identifier"
      ? (name as NodePath<Babel.Identifier>)
      : null
  }

  if (parentPath.type === "AssignmentExpression") {
    let variablePath = parentPath as NodePath<Babel.AssignmentExpression>
    let name = variablePath.get("left")
    return name.node.type === "Identifier"
      ? (name as NodePath<Babel.Identifier>)
      : null
  }

  if (path.node.type === "ArrowFunctionExpression") {
    return null
  }

  return path.node.id && path.node.id.type === "Identifier"
    ? (path.get("id") as NodePath<Babel.Identifier>)
    : null
}

export function isReferenced(ident: NodePath<Babel.Identifier>): boolean {
  let binding = ident.scope.getBinding(ident.node.name)
  if (binding?.referenced) {
    // Functions can reference themselves, so we need to check if there's a
    // binding outside the function scope or not.
    if (binding.path.type === "FunctionDeclaration") {
      return !binding.constantViolations
        .concat(binding.referencePaths)
        // Check that every reference is contained within the function:
        .every((ref) => ref.findParent((parent) => parent === binding?.path))
    }

    return true
  }
  return false
}
