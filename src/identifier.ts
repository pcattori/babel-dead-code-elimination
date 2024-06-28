import { type NodePath, type Babel } from "./babel-esm"

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
