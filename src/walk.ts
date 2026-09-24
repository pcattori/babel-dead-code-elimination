import {
  traverse,
  t,
  BabelNodePath,
  type Babel,
  type NodePath,
} from "./babel-esm"

type Frame = {
  node: Babel.Node
  parent: Frame | null
  container: unknown
  listKey: string | undefined
  key: string | number | null
  path: NodePath | null
}

/** The Program path of `ast`. Creates (and crawls) its scope if necessary. */
export function getProgramPath(ast: Babel.File): NodePath<Babel.Program> {
  let programPath!: NodePath<Babel.Program>
  traverse(ast, {
    Program(path) {
      programPath = path
      path.stop()
    },
  })
  return programPath
}

/**
 * Calls `callback` with the path of every node below `root` that `matches`,
 * in the order a Babel traversal would enter them. The walk reads nodes
 * directly instead of running Babel's traversal machinery for every node.
 * Matching paths come from Babel's path cache, so they are the same objects a
 * traversal provides.
 */
export function forEachMatchingPath(
  root: NodePath,
  matches: (node: Babel.Node) => boolean,
  callback: (path: NodePath) => void,
): void {
  const walk = (frame: Frame): void => {
    const node = frame.node
    if (matches(node)) callback(materialize(frame))
    const keys = t.VISITOR_KEYS[node.type]
    if (!keys) return
    for (const key of keys) {
      const child = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          const element: Babel.Node | null = child[i]
          if (element?.type === undefined) continue
          walk({
            node: element,
            parent: frame,
            container: child,
            listKey: key,
            key: i,
            path: null,
          })
        }
      } else if (isNode(child)) {
        walk({
          node: child,
          parent: frame,
          container: node,
          listKey: undefined,
          key,
          path: null,
        })
      }
    }
  }
  walk({
    node: root.node,
    parent: null,
    container: null,
    listKey: undefined,
    key: null,
    path: root,
  })
}

const isNode = (value: unknown): value is Babel.Node =>
  typeof (value as Babel.Node | null)?.type === "string"

function materialize(frame: Frame): NodePath {
  if (frame.path) return frame.path
  const parentPath = materialize(frame.parent!)
  // The typings only describe single-child containers and omit listKey.
  const options = {
    parentPath,
    parent: parentPath.node,
    container: frame.container,
    listKey: frame.listKey,
    key: frame.key,
  } as unknown as Parameters<typeof BabelNodePath.get>[0]
  const path = BabelNodePath.get(options) as unknown as NodePath
  path.setContext(parentPath.context)
  frame.path = path
  return path
}
