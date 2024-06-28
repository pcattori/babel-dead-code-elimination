import { t, type Node, type NodePath } from "./babel-esm"
import { unexpected } from "./errors"

export function findVariables(
  patternPath: NodePath<t.ObjectPattern | t.ArrayPattern>,
): NodePath<t.Identifier>[] {
  let variables: NodePath<t.Identifier>[] = []
  function recurse(path: NodePath<Node | null>): void {
    if (path.isIdentifier()) {
      variables.push(path)
      return
    }
    if (path.isObjectPattern()) {
      return path.get("properties").forEach(recurse)
    }
    if (path.isObjectProperty()) {
      return recurse(path.get("value"))
    }
    if (path.isArrayPattern()) {
      let _elements = path.get("elements")
      return _elements.forEach(recurse)
    }
    if (path.isAssignmentPattern()) {
      return recurse(path.get("left"))
    }
    if (path.isRestElement()) {
      return recurse(path.get("argument"))
    }
    if (path.node === null) return
    throw unexpected(path)
  }
  recurse(patternPath)
  return variables
}

export function remove(path: NodePath<t.ObjectPattern | t.ArrayPattern>) {
  let parent = path.parentPath
  if (parent.isVariableDeclarator()) {
    return parent.remove()
  }
  if (parent.isArrayPattern()) {
    parent.node.elements[path.key as number] = null
    return
  }
  if (parent.isObjectProperty()) {
    return parent.remove()
  }
  if (parent.isRestElement()) {
    return parent.remove()
  }
  if (parent.isAssignmentPattern()) {
    if (t.isObjectProperty(parent.parent)) {
      return parent.parentPath.remove()
    }
    if (t.isArrayPattern(parent.parent)) {
      parent.parent.elements[parent.key as number] = null
      return
    }
    throw unexpected(parent.parentPath)
  }
  throw unexpected(parent)
}
