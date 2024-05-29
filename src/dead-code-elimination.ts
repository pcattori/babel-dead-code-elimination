// Adapted from https://github.com/egoist/babel-plugin-eliminator/blob/d29859396b7708b7f7abbacdd951cbbc80902f00/src/index.ts

import {
  traverse,
  t,
  type NodePath,
  type BabelTypes,
  type ParseResult,
} from "./babel-esm"
import * as Identifier from "./identifier"

type IdentifierPath = NodePath<BabelTypes.Identifier>

/**
 * @param candidates - If provided, only these identifiers will be candidates for dead code elimination.
 */
export default function (
  ast: ParseResult<BabelTypes.File>,
  candidates?: Set<IdentifierPath>
) {
  let referencesRemovedInThisPass: number

  let shouldBeRemoved = (ident: IdentifierPath) => {
    if (Identifier.isReferenced(ident)) return false
    if (!candidates) return true
    return candidates.has(ident)
  }

  let sweepFunction = (
    path: NodePath<
      | BabelTypes.FunctionDeclaration
      | BabelTypes.FunctionExpression
      | BabelTypes.ArrowFunctionExpression
    >
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
    >
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
        if (path.node.id.type === "Identifier") {
          let local = path.get("id") as NodePath<BabelTypes.Identifier>
          if (shouldBeRemoved(local)) {
            ++referencesRemovedInThisPass
            path.remove()
          }
        } else if (path.node.id.type === "ObjectPattern") {
          let pattern = path.get("id") as NodePath<BabelTypes.ObjectPattern>

          let beforeCount = referencesRemovedInThisPass
          let properties = pattern.get("properties")
          properties.forEach((property) => {
            let local = property.get(
              property.node.type === "ObjectProperty"
                ? "value"
                : property.node.type === "RestElement"
                ? "argument"
                : (function () {
                    throw new Error("invariant")
                  })()
            ) as NodePath<BabelTypes.Identifier>

            if (shouldBeRemoved(local)) {
              ++referencesRemovedInThisPass
              property.remove()
            }
          })

          if (
            beforeCount !== referencesRemovedInThisPass &&
            pattern.get("properties").length < 1
          ) {
            path.remove()
          }
        } else if (path.node.id.type === "ArrayPattern") {
          let pattern = path.get("id") as NodePath<BabelTypes.ArrayPattern>

          let beforeCount = referencesRemovedInThisPass
          let elements = pattern.get("elements")
          elements.forEach((e) => {
            let local: NodePath<BabelTypes.Identifier>
            if (e.node?.type === "Identifier") {
              local = e as NodePath<BabelTypes.Identifier>
            } else if (e.node?.type === "RestElement") {
              local = e.get("argument") as NodePath<BabelTypes.Identifier>
            } else {
              return
            }

            if (shouldBeRemoved(local)) {
              ++referencesRemovedInThisPass
              e.remove()
            }
          })

          if (
            beforeCount !== referencesRemovedInThisPass &&
            pattern.get("elements").length < 1
          ) {
            path.remove()
          }
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
