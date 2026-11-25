import { t, type NodePath, type Babel, type Binding } from "./babel-esm"
import { isRestFiltered } from "./pattern"

/**
 * Finds bindings that nothing elimination keeps can reach, through references
 * inside declarations.
 * @param isKept - Bindings that elimination keeps regardless of references.
 */
export default function findRemovableBindings(
  programPath: NodePath<Babel.Program>,
  isKept?: (binding: Binding) => boolean,
): Set<Binding> {
  // Babel keeps bindings in a dictionary-mode object, where Object.keys with
  // indexed reads is several times faster than Object.values.
  const bindingsByName = programPath.scope.bindings
  const names = Object.keys(bindingsByName)
  const allBindings = new Array<Binding>(names.length)
  for (let i = 0; i < names.length; i++) {
    allBindings[i] = bindingsByName[names[i]!]!
  }
  const n = allBindings.length
  if (n === 0) return new Set()

  // Build a graph of bindings for reachability
  // if binding `a` is referenced inside binding `b`'s definition, refs[b] contains a
  // Map each declaration node to the bindings it declares for fast lookup when
  // tracing refs. A destructuring declarator declares several bindings.
  const pathNodeToIdx = new Map<Babel.Node, number[]>()
  const refs: (number[] | null)[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const node = allBindings[i]!.path?.node
    if (node) {
      const indices = pathNodeToIdx.get(node)
      if (indices) indices.push(i)
      else pathNodeToIdx.set(node, [i])
    }
    refs[i] = null
  }

  // Mark bindings as excluded (not removable) if they have external refs, reassignments, are loop iterators, or are kept
  const excluded = new Uint8Array(n)
  // excluded bindings whose refs need to be excluded too
  const exclusionQueue: number[] = []
  // bindings that might be removable
  let candidateCount = n

  for (let i = 0; i < n; i++) {
    const binding = allBindings[i]!

    if (
      binding.constantViolations.length > 0 ||
      isLoopIteratorBinding(binding) ||
      !isRemovableDeclaration(binding) ||
      isRestFilteredBinding(binding) ||
      isKept?.(binding)
    ) {
      excluded[i] = 1
      candidateCount--
      exclusionQueue.push(i)
      continue
    }

    for (const refPath of binding.referencePaths) {
      if (isTypeOnlyReference(refPath)) continue
      // Walk up the AST to find which binding (if any) contains this reference
      let path: NodePath | null = refPath
      let containers: number[] | undefined
      while (path) {
        containers = pathNodeToIdx.get(path.node)
        if (containers !== undefined) break
        path = path.parentPath
      }
      if (containers !== undefined) {
        // Every binding of a declarator keeps its initializer alive.
        for (const containerIdx of containers) {
          const containerRefs = refs[containerIdx]
          if (!containerRefs) {
            refs[containerIdx] = [i]
            // References to this target are processed together, so any duplicate
            // edge is the last one appended to its containing declaration.
          } else if (containerRefs[containerRefs.length - 1] !== i) {
            containerRefs.push(i)
          }
        }
      } else if (!excluded[i]) {
        excluded[i] = 1
        candidateCount--
        exclusionQueue.push(i)
        break
      }
    }
  }

  // Propagate exclusions: if excluded binding `a` references `b`, then `b` is also not removable
  while (exclusionQueue.length > 0) {
    const idx = exclusionQueue.pop()!
    const targets = refs[idx]
    if (targets) {
      for (const target of targets) {
        if (!excluded[target]) {
          excluded[target] = 1
          candidateCount--
          exclusionQueue.push(target)
        }
      }
    }
  }

  if (candidateCount === 0) return new Set()

  // Every binding left is reachable from nothing that elimination keeps, so it
  // is dead, whether it forms a cycle or is only referenced by dead code.
  // Unreferenced ones are removed anyway, so only referenced ones are listed.
  const removable = new Set<Binding>()
  for (let i = 0; i < n; i++) {
    const binding = allBindings[i]!
    if (!excluded[i] && isReferenced(binding)) removable.add(binding)
  }
  return removable
}

// Elimination only removes these declarations. Any other binding (such as a
// TypeScript enum) is kept and keeps everything it references alive.
function isRemovableDeclaration(binding: Binding): boolean {
  switch (binding.path.type) {
    case "ClassDeclaration":
      return !hasDefinitionSideEffects(
        binding.path as NodePath<Babel.ClassDeclaration>,
      )
    case "VariableDeclarator":
    case "FunctionDeclaration":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
      return true
  }
  return false
}

// Elimination keeps object pattern properties that are filtered out of a rest
// element, even when they are unused.
function isRestFilteredBinding(binding: Binding): boolean {
  const declarator = binding.path.node
  return (
    t.isVariableDeclarator(declarator) &&
    isRestFiltered(declarator.id, binding.identifier)
  )
}

// Nodes whose child names a value only in a type: `typeof x`, `T<x.y>`,
// `implements x`, `interface I extends x`.
const TYPE_REFERENCE_PARENTS = new Set([
  "TSTypeQuery",
  "TSTypeReference",
  "TSExpressionWithTypeArguments",
  "TSInterfaceHeritage",
  "TSClassImplements",
])

/**
 * Babel counts the name of a same-named TypeScript type alias, interface or
 * overload signature, and a name used in a type (`typeof x`), as a reference
 * to a value binding. These disappear with the types and never read the value.
 */
function isTypeOnlyReference(path: NodePath): boolean {
  if (
    path.key === "id" &&
    (path.parentPath?.isTSTypeAliasDeclaration() ||
      path.parentPath?.isTSInterfaceDeclaration() ||
      path.parentPath?.isTSDeclareFunction()) === true
  ) {
    return true
  }
  let parent = path.parentPath
  while (parent?.isTSQualifiedName()) parent = parent.parentPath
  return parent !== null && TYPE_REFERENCE_PARENTS.has(parent.type)
}

/** Whether code other than TypeScript declarations references the binding. */
export function isReferenced(binding: Binding): boolean {
  return (
    binding.referenced &&
    binding.referencePaths.some((path) => !isTypeOnlyReference(path))
  )
}

/**
 * Whether defining the class runs code whose effects removal would drop:
 * decorators (which commonly register the class), static blocks, impure
 * static initializers or computed keys, or an `extends` clause other than a
 * (dotted) name.
 */
export function hasDefinitionSideEffects(
  path: NodePath<Babel.ClassDeclaration>,
): boolean {
  const { node, scope } = path
  if (node.decorators?.length) return true
  if (node.superClass && !isName(node.superClass)) return true
  for (const member of node.body.body) {
    if (t.isStaticBlock(member)) return true
    if ("decorators" in member && member.decorators?.length) return true
    if ("computed" in member && member.computed && !scope.isPure(member.key)) {
      return true
    }
    if (
      (t.isClassProperty(member) ||
        t.isClassPrivateProperty(member) ||
        t.isClassAccessorProperty(member)) &&
      member.static &&
      member.value &&
      !scope.isPure(member.value)
    ) {
      return true
    }
    if (
      (t.isClassMethod(member) || t.isTSDeclareMethod(member)) &&
      member.params.some((param) => param.decorators?.length)
    ) {
      return true
    }
  }
  return false
}

const isName = (node: Babel.Node): boolean =>
  t.isIdentifier(node) ||
  (t.isMemberExpression(node) && !node.computed && isName(node.object))

/** Resolves the binding that a declaration's identifier declares. */
export function getDeclaredBinding(
  ident: NodePath<Babel.Identifier>,
): Binding | undefined {
  // A function declaration's id belongs to the enclosing scope. Its path's
  // scope is the function's own scope, where a parameter can shadow the name.
  const scope =
    ident.key === "id" && ident.parentPath.isFunctionDeclaration()
      ? ident.parentPath.scope.parent
      : ident.scope
  return scope.getBinding(ident.node.name)
}

export function isLoopIteratorBinding(binding: Binding): boolean {
  if (binding.path.type === "VariableDeclarator") {
    const declPath = binding.path.parentPath
    if (
      declPath?.key === "left" &&
      (declPath.parent.type === "ForOfStatement" ||
        declPath.parent.type === "ForInStatement")
    ) {
      return true
    }
  }
  return false
}
