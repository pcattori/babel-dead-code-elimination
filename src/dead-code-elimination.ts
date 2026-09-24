import {
  t,
  type NodePath,
  type Babel,
  type ParseResult,
  type Binding,
} from "./babel-esm"
import * as Pattern from "./pattern"
import { forEachMatchingPath, getProgramPath } from "./walk"
import { unexpected } from "./errors"
import {
  crawlProgram,
  isAttached,
  mustCrawlProgram,
  refreshBindings,
  snapshotBindings,
  type BindingSnapshot,
} from "./scope"
import findRemovableBindings, {
  getDeclaredBinding,
  hasDefinitionSideEffects,
  isLoopIteratorBinding,
  isReferenced,
} from "./find-removable-bindings"

const ELIMINATION_TYPES = new Set([
  "ImportDeclaration",
  "VariableDeclarator",
  "ObjectPattern",
  "ArrayPattern",
  "FunctionDeclaration",
  "ClassDeclaration",
])

/**
 * @param candidates - If provided, only these identifiers will be candidates for dead code elimination.
 */
export default function (
  ast: ParseResult<Babel.File>,
  candidates?: Set<NodePath<Babel.Identifier>>,
) {
  let needsAnotherPass = false
  let programPath!: NodePath<Babel.Program>
  const paths: Array<NodePath> = []

  // Bindings that form closed cycles (SCCs) with no external references
  let removableBindings: Set<Binding>
  let snapshot: BindingSnapshot | undefined

  const hasCandidates = candidates !== undefined
  // Elimination keeps bindings outside the candidate set, so they must keep
  // everything they reference alive, including members of reference cycles.
  let isKept: ((binding: Binding) => boolean) | undefined
  if (hasCandidates) {
    const candidateNodes = new Set<Babel.Node>()
    for (const candidate of candidates) candidateNodes.add(candidate.node)
    isKept = (binding) => !candidateNodes.has(binding.identifier)
  }
  const shouldBeRemoved = (ident: NodePath<Babel.Identifier>): boolean => {
    if (hasCandidates && !candidates.has(ident)) return false

    const binding = getDeclaredBinding(ident)

    // Only remove a declaration whose own binding is known. Removing a sole
    // declarator also removes its declaration, and Babel deletes the name
    // from scope for both, so the second deletion can drop a same-named
    // binding of an enclosing scope until the next crawl.
    if (binding?.identifier !== ident.node) return false

    // If binding is part of a removable cycle, allow removal
    if (removableBindings.has(binding)) return true

    if (isReferenced(binding)) return false

    // Preserve bindings with constant violations (assignments like x = 2)
    if (binding.constantViolations.length > 0) return false

    // Preserve loop iterator bindings (for...of, for...in)
    if (isLoopIteratorBinding(binding)) return false

    return true
  }

  // Call before removing anything but imports. Such a removal can make other
  // declarations unused, so another pass follows, and it can make Babel drop
  // unrelated bindings by name, so bindings are recorded before the first one.
  const willRemove = (): void => {
    needsAnotherPass = true
    snapshot ??= snapshotBindings(programPath)
  }

  const visit = (path: NodePath): void => {
    if (path.isImportDeclaration()) {
      // Imports contain no references to other local bindings, so removing
      // them cannot make another declaration dead or require another pass.
      if (path.node.specifiers.length === 0) {
        return
      }
      for (let specifier of path.get("specifiers")) {
        let local = specifier.get("local")
        if (shouldBeRemoved(local)) {
          specifier.remove()
        }
      }
      if (path.node.specifiers.length === 0) {
        path.remove()
      }
      return
    }
    if (path.isVariableDeclarator()) {
      let id = path.get("id")
      if (id.isIdentifier()) {
        if (shouldBeRemoved(id) && !callsInFunction(path)) {
          willRemove()
          path.remove()
        }
      } else if (id.isObjectPattern() || id.isArrayPattern()) {
        for (let variable of Pattern.findVariables(id)) {
          // Keep unused variables that are filtered out of an object rest: in
          // `let { a, ...rest } = ...`, removing `a` would add it to `rest`.
          // This includes defaults and nested patterns, and takes precedence
          // over removable cycles.
          if (Pattern.isRestFiltered(id.node, variable.node)) continue
          if (!shouldBeRemoved(variable)) continue
          if (callsInFunction(path)) break

          let parent = variable.parentPath

          if (parent.isObjectProperty()) {
            willRemove()
            parent.remove()
            continue
          }

          if (parent.isArrayPattern()) {
            willRemove()
            parent.node.elements[variable.key as number] = null
            continue
          }

          if (parent.isAssignmentPattern()) {
            if (t.isObjectProperty(parent.parent)) {
              willRemove()
              parent.parentPath?.remove()
              continue
            }
            if (t.isArrayPattern(parent.parent)) {
              willRemove()
              parent.parent.elements[parent.key as number] = null
              continue
            }
            throw unexpected(parent)
          }

          if (parent.isRestElement()) {
            willRemove()
            parent.remove()
            continue
          }

          throw unexpected(parent)
        }
      }
      return
    }
    if (path.isObjectPattern()) {
      if (path.node.properties.length !== 0) {
        return
      }
      let declarator = Pattern.findDeclarator(path)
      if (
        declarator &&
        !Pattern.isRestFiltered(declarator.node.id, path.node) &&
        !callsInFunction(declarator)
      ) {
        willRemove()
        Pattern.remove(path)
      }
      return
    }
    if (path.isArrayPattern()) {
      if (!path.node.elements.every((element) => element === null)) {
        return
      }
      let declarator = Pattern.findDeclarator(path)
      if (
        declarator &&
        !Pattern.isRestFiltered(declarator.node.id, path.node) &&
        !callsInFunction(declarator)
      ) {
        willRemove()
        Pattern.remove(path)
      }
      return
    }
    if (path.isFunctionDeclaration()) {
      let id = path.get("id")
      if (id.isIdentifier() && shouldBeRemoved(id)) {
        willRemove()
        // TypeScript overload signatures cannot outlive their implementation.
        for (let sibling of path.getAllPrevSiblings()) {
          if (
            sibling.isTSDeclareFunction() &&
            sibling.node.id?.name === id.node.name
          ) {
            sibling.remove()
          }
        }
        path.remove()
      }
      return
    }
    if (path.isClassDeclaration()) {
      let id = path.get("id")
      if (
        id.isIdentifier() &&
        shouldBeRemoved(id) &&
        !hasDefinitionSideEffects(path)
      ) {
        willRemove()
        path.remove()
      }
      return
    }
  }

  const crawl = mustCrawlProgram(ast)
  programPath = getProgramPath(ast)
  if (crawl) crawlProgram(programPath)
  removableBindings = findRemovableBindings(programPath, isKept)
  // Collect the declaration and pattern paths in source order without a Babel
  // traversal (see walk.ts).
  forEachMatchingPath(
    programPath,
    (node) => ELIMINATION_TYPES.has(node.type),
    (path) => paths.push(path),
  )

  // Elimination only removes nodes. Revisit the declaration paths in source
  // order, without traversing unchanged expressions on every pass, and update
  // the bindings instead of crawling the program again.
  for (;;) {
    for (const path of paths) {
      if (isAttached(path)) {
        visit(path)
      }
    }
    if (!needsAnotherPass) break
    needsAnotherPass = false
    refreshBindings(snapshot!)
    removableBindings = findRemovableBindings(programPath, isKept)
  }
}

/**
 * Whether a declarator inside a function initializes its bindings with a call.
 * Such calls run on every invocation, and some must run in the same order in
 * every build: removing an unused `const id = useId()` from a component only in
 * the server build shifts React's hook-based ids. Declarations like these are
 * kept even when their bindings are unused.
 */
function callsInFunction(path: NodePath<Babel.VariableDeclarator>): boolean {
  let init = path.node.init
  while (
    t.isAwaitExpression(init) ||
    t.isParenthesizedExpression(init) ||
    t.isTSAsExpression(init) ||
    t.isTSSatisfiesExpression(init) ||
    t.isTSNonNullExpression(init) ||
    t.isTSTypeAssertion(init) ||
    t.isTypeCastExpression(init)
  ) {
    init = t.isAwaitExpression(init) ? init.argument : init.expression
  }
  return (
    (t.isCallExpression(init) ||
      t.isOptionalCallExpression(init) ||
      t.isNewExpression(init) ||
      t.isTaggedTemplateExpression(init)) &&
    path.getFunctionParent() !== null
  )
}
