import {
  traverse,
  t,
  type NodePath,
  type Babel,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"
import * as Pattern from "./pattern"
import { unexpected } from "./errors"

/**
 * @param candidates - If provided, only these identifiers will be candidates for dead code elimination.
 */
export default function (
  ast: ParseResult<Babel.File>,
  candidates?: Set<NodePath<Babel.Identifier>>,
) {
  let removals: number

  let shouldBeRemoved = (ident: NodePath<Babel.Identifier>) => {
    if (Identifier.isReferenced(ident)) return false
    if (candidates && !candidates.has(ident)) return false

    // Preserve unused variables in object patterns when rest element is used
    // For example, in `let { a, ...rest } = ...` even if `a` is unused
    // it needs to remain in the object pattern so that `a` is filtered out of `rest`
    if (ident.parentPath.parentPath?.isObjectPattern()) {
      if (ident.parentPath.isRestElement()) return true
      return !ident.parentPath.parentPath
        .get("properties")
        .at(-1)
        ?.isRestElement()
    }

    if (!candidates) return true
    return candidates.has(ident)
  }

  do {
    removals = 0

    traverse(ast, {
      Program(path) {
        path.scope.crawl()
      },
      ImportDeclaration(path) {
        let removalsBefore = removals
        for (let specifier of path.get("specifiers")) {
          let local = specifier.get("local")
          if (shouldBeRemoved(local)) {
            specifier.remove()
            removals++
          }
        }
        if (removals > removalsBefore && path.node.specifiers.length === 0) {
          path.remove()
        }
      },
      VariableDeclarator(path) {
        let id = path.get("id")
        if (id.isIdentifier()) {
          if (shouldBeRemoved(id)) {
            path.remove()
            removals++
          }
        } else if (id.isObjectPattern() || id.isArrayPattern()) {
          for (let variable of Pattern.findVariables(id)) {
            if (!shouldBeRemoved(variable)) continue

            let parent = variable.parentPath

            if (parent.isObjectProperty()) {
              parent.remove()
              removals++
              continue
            }

            if (parent.isArrayPattern()) {
              parent.node.elements[variable.key as number] = null
              removals++
              continue
            }

            if (parent.isAssignmentPattern()) {
              if (t.isObjectProperty(parent.parent)) {
                parent.parentPath?.remove()
                removals++
                continue
              }
              if (t.isArrayPattern(parent.parent)) {
                parent.parent.elements[parent.key as number] = null
                removals++
                continue
              }
              throw unexpected(parent)
            }

            if (parent.isRestElement()) {
              parent.remove()
              removals++
              continue
            }

            throw unexpected(parent)
          }
        }
      },
      ObjectPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isFunctionParam =
          path.parentPath.isFunction() &&
          path.parentPath.node.params.includes(path.node)
        let isEmpty = path.node.properties.length === 0
        if (isWithinDeclarator && !isFunctionParam && isEmpty) {
          Pattern.remove(path)
          removals++
        }
      },
      ArrayPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isFunctionParam =
          path.parentPath.isFunction() &&
          path.parentPath.node.params.includes(path.node)
        let isEmpty = path.node.elements.every((e) => e === null)
        if (isWithinDeclarator && !isFunctionParam && isEmpty) {
          Pattern.remove(path)
          removals++
        }
      },
      FunctionDeclaration(path) {
        let id = path.get("id")
        if (id.isIdentifier() && shouldBeRemoved(id)) {
          removals++
          if (
            t.isAssignmentExpression(path.parentPath.node) ||
            t.isVariableDeclarator(path.parentPath.node)
          ) {
            path.parentPath.remove()
          } else {
            path.remove()
          }
        }
      },
    })
  } while (removals > 0)
}
