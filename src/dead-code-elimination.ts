// Adapted from https://github.com/egoist/babel-plugin-eliminator/blob/d29859396b7708b7f7abbacdd951cbbc80902f00/src/index.ts

import {
  traverse,
  t,
  type Node,
  type NodePath,
  type BabelTypes,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"

/**
 * @param candidates - If provided, only these identifiers will be candidates for dead code elimination.
 */
export default function (
  ast: ParseResult<BabelTypes.File>,
  candidates?: Set<Identifier.Path>,
) {
  let referencesRemovedInThisPass: number

  let shouldBeRemoved = (ident: Identifier.Path) => {
    if (Identifier.isReferenced(ident)) return false
    if (!candidates) return true
    return candidates.has(ident)
  }

  let sweepFunction = (
    path: NodePath<
      | BabelTypes.FunctionDeclaration
      | BabelTypes.FunctionExpression
      | BabelTypes.ArrowFunctionExpression
    >,
  ) => {
    let identifier = Identifier.fromFunction(path)
    if (identifier?.node && shouldBeRemoved(identifier)) {
      ++referencesRemovedInThisPass

      if (
        t.isAssignmentExpression(path.parentPath.node) ||
        t.isVariableDeclarator(path.parentPath.node)
      ) {
        path.parentPath.remove()
      } else {
        path.remove()
      }
    }
  }

  let sweepImport = (
    path: NodePath<
      | BabelTypes.ImportSpecifier
      | BabelTypes.ImportDefaultSpecifier
      | BabelTypes.ImportNamespaceSpecifier
    >,
  ) => {
    let local = path.get("local")
    if (shouldBeRemoved(local)) {
      ++referencesRemovedInThisPass
      path.remove()
      if (
        (path.parent as BabelTypes.ImportDeclaration).specifiers.length === 0
      ) {
        path.parentPath.remove()
      }
    }
  }

  // Traverse again to remove unused references. This happens at least once,
  // then repeats until no more references are removed.
  do {
    referencesRemovedInThisPass = 0

    traverse(ast, {
      Program(path) {
        path.scope.crawl()
      },
      // eslint-disable-next-line no-loop-func
      VariableDeclarator(path) {
        let id = path.get("id")
        if (id.isIdentifier()) {
          if (shouldBeRemoved(id)) {
            ++referencesRemovedInThisPass
            path.remove()
          }
        } else if (id.isObjectPattern() || id.isArrayPattern()) {
          let vars = findVariablesInPattern(id)
          for (let v of vars) {
            if (Identifier.isReferenced(v)) continue

            let parent = v.parentPath
            ++referencesRemovedInThisPass

            if (parent.isObjectProperty()) {
              parent.remove()
              continue
            }

            if (parent.isArrayPattern()) {
              parent.node.elements[v.key as number] = null
              continue
            }

            if (parent.isAssignmentPattern()) {
              if (t.isObjectProperty(parent.parent)) {
                parent.parentPath?.remove()
                continue
              }
              if (t.isArrayPattern(parent.parent)) {
                parent.parent.elements[parent.key as number] = null
                continue
              }
              throw unexpected(parent)
            }

            if (parent.isRestElement()) {
              parent.remove()
              continue
            }

            throw unexpected(parent)
          }
        }
      },
      ObjectPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isEmpty = path.node.properties.length === 0
        if (isWithinDeclarator && isEmpty) {
          removePattern(path)
          referencesRemovedInThisPass++
        }
      },
      ArrayPattern(path) {
        let isWithinDeclarator =
          path.find((p) => p.isVariableDeclarator()) !== null
        let isEmpty = path.node.elements.every((e) => e === null)
        if (isWithinDeclarator && isEmpty) {
          removePattern(path)
          referencesRemovedInThisPass++
        }
      },
      FunctionDeclaration: sweepFunction,
      FunctionExpression: sweepFunction,
      ArrowFunctionExpression: sweepFunction,
      ImportSpecifier: sweepImport,
      ImportDefaultSpecifier: sweepImport,
      ImportNamespaceSpecifier: sweepImport,
    })
  } while (referencesRemovedInThisPass)
}

function findVariablesInPattern(
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

function removePattern(path: NodePath<t.ObjectPattern | t.ArrayPattern>) {
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

function unexpected(path: NodePath<Node | null>) {
  let type = path.node === null ? "null" : path.node.type
  return path.buildCodeFrameError(
    `[babel-dead-code-elimination] unexpected node type: ${type}`,
  )
}
