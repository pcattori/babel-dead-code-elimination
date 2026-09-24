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

/**
 * Whether `target` sits in a property of an object pattern that ends with a
 * rest element. Removing it would add that property to the rest object.
 */
export function isRestFiltered(pattern: Node, target: Node): boolean {
  return restFiltered(pattern, target, false) === true
}

function restFiltered(
  node: Node | null | undefined,
  target: Node,
  filtered: boolean,
): boolean | undefined {
  if (!node) return undefined
  if (node === target) return filtered
  if (t.isObjectPattern(node)) {
    let hasRest = t.isRestElement(node.properties.at(-1))
    for (let property of node.properties) {
      let result = t.isRestElement(property)
        ? restFiltered(property.argument, target, filtered)
        : restFiltered(property.value, target, filtered || hasRest)
      if (result !== undefined) return result
    }
    return undefined
  }
  if (t.isArrayPattern(node)) {
    for (let element of node.elements) {
      let result = restFiltered(element, target, filtered)
      if (result !== undefined) return result
    }
    return undefined
  }
  if (t.isAssignmentPattern(node)) {
    return restFiltered(node.left, target, filtered)
  }
  if (t.isRestElement(node)) {
    return restFiltered(node.argument, target, filtered)
  }
  return undefined
}

/**
 * The declarator whose id contains `path`, following only pattern links.
 * Patterns in parameters, catch clauses, assignments or type annotations
 * inside an initializer do not belong to the declarator.
 */
export function findDeclarator(
  path: NodePath<t.ObjectPattern | t.ArrayPattern>,
): NodePath<t.VariableDeclarator> | null {
  let child: NodePath = path
  let parent: NodePath | null = path.parentPath
  while (parent) {
    if (parent.isVariableDeclarator()) {
      // A for-in/of head needs its declaration: `for (const {} of items)`.
      let isLoopHead = parent.parentPath.key === "left"
      return child.key === "id" && !isLoopHead ? parent : null
    }
    let isPatternLink =
      (parent.isObjectProperty() && child.key === "value") ||
      parent.isObjectPattern() ||
      parent.isArrayPattern() ||
      (parent.isAssignmentPattern() && child.key === "left") ||
      parent.isRestElement()
    if (!isPatternLink) return null
    child = parent
    parent = parent.parentPath
  }
  return null
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
