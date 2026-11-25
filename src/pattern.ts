import { t, type Node, type NodePath } from "./babel-esm"
import { unexpected } from "./errors"

export function findVariables(
  patternPath: NodePath<t.ObjectPattern | t.ArrayPattern>,
): NodePath<t.Identifier>[] {
  let variables: NodePath<t.Identifier>[] = []
  function recurse(path: NodePath<Node | null>): void {
    if (path.isIdentifier()) {
      variables.push(path)
    } else if (path.isObjectPattern()) {
      path.get("properties").forEach(recurse)
    } else if (path.isObjectProperty()) {
      recurse(path.get("value"))
    } else if (path.isArrayPattern()) {
      path.get("elements").forEach(recurse)
    } else if (path.isAssignmentPattern()) {
      recurse(path.get("left"))
    } else if (path.isRestElement()) {
      recurse(path.get("argument"))
    } else if (path.node !== null) {
      throw unexpected(path)
    }
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
  // A pattern is never the program, so every link up to a declarator or to a
  // node that is not part of a pattern has a parent.
  let parent: NodePath = path.parentPath
  for (;;) {
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
    parent = parent.parentPath!
  }
}

/**
 * Removes a variable or an emptied pattern from the declaration pattern that
 * holds it: its property, its array element (leaving a hole, so later
 * elements keep their positions), or its rest element.
 */
export function remove(
  path: NodePath<t.Identifier | t.ObjectPattern | t.ArrayPattern>,
) {
  let parent = path.parentPath
  if (
    parent.isVariableDeclarator() ||
    parent.isObjectProperty() ||
    parent.isRestElement()
  ) {
    parent.remove()
  } else if (parent.isArrayPattern()) {
    parent.node.elements[path.key as number] = null
  } else if (parent.isAssignmentPattern()) {
    if (t.isObjectProperty(parent.parent)) {
      parent.parentPath.remove()
    } else if (t.isArrayPattern(parent.parent)) {
      parent.parent.elements[parent.key as number] = null
    } else {
      throw unexpected(parent.parentPath)
    }
  } else {
    throw unexpected(parent)
  }
}
