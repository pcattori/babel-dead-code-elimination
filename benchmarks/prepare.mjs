import { createRequire } from "node:module"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"

const [rootArgument, outputArgument, mode, ...inputs] = process.argv.slice(2)
if (
  !rootArgument ||
  !outputArgument ||
  !inputs.length ||
  !["--manifest", "--sources", "--refs"].includes(mode)
) {
  throw new Error(
    "Usage: node prepare.mjs REPOSITORY OUTPUT (--manifest variants.json | --sources DIR... | --refs REF...)",
  )
}
const root = resolve(rootArgument)
const outputRoot = resolve(outputArgument)
const require = createRequire(join(root, "package.json"))
const vitestRequire = createRequire(require.resolve("vitest/package.json"))
const viteRequire = createRequire(vitestRequire.resolve("vite/package.json"))
const esbuild = viteRequire("esbuild")
const files = [
  "babel-esm",
  "errors",
  "pattern",
  "dead-code-elimination",
  "find-referenced-identifiers",
  "find-removable-bindings",
  "index",
].map((name) => `src/${name}.ts`)
const hash = (value) => createHash("sha256").update(value).digest("hex")
let variants
if (mode === "--manifest") {
  if (inputs.length !== 1) {
    throw new Error("--manifest accepts one file")
  }
  const manifestFile = resolve(inputs[0])
  variants = JSON.parse(readFileSync(manifestFile, "utf8")).map((variant) => ({
    ...variant,
    sourceDirectory: resolve(
      dirname(manifestFile),
      variant.sourceDirectory ?? `variants/${variant.name}`,
    ),
  }))
} else if (mode === "--sources") {
  variants = inputs.map((source) => ({
    name: basename(resolve(source)),
    sourceDirectory: resolve(source),
  }))
} else {
  variants = inputs.map((ref, index) => {
    const commit = execFileSync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
      { cwd: root, encoding: "utf8" },
    ).trim()
    return {
      name: `${String(index).padStart(2, "0")}-${commit.slice(0, 12)}`,
      ref,
      commit,
    }
  })
}
const prepared = []
for (const variant of variants) {
  if (
    !/^[\w.-]+$/.test(variant.name) ||
    variant.name === "." ||
    variant.name === ".."
  ) {
    throw new Error(`Invalid variant name: ${variant.name}`)
  }
  const destination = join(outputRoot, variant.name)
  if (existsSync(destination)) {
    throw new Error(`Refusing to overwrite prepared variant: ${destination}`)
  }
  mkdirSync(join(destination, "src"), { recursive: true })
  const sourceHashes = {}
  for (const file of files) {
    let source = variant.commit
      ? execFileSync("git", ["show", `${variant.commit}:${file}`], {
          cwd: root,
          encoding: "utf8",
        })
      : readFileSync(join(variant.sourceDirectory, file), "utf8")
    sourceHashes[file] = hash(source)
    if (variant.sources && sourceHashes[file] !== variant.sources[file]) {
      throw new Error(`Source hash mismatch: ${variant.name}/${file}`)
    }
    if (file === "src/babel-esm.ts") {
      const traverseRequire = /require\s*\(\s*(["'])@babel\/traverse\1\s*\)/g
      if (source.match(traverseRequire)?.length !== 1) {
        throw new Error(
          `Expected one Babel traversal require in ${variant.name}`,
        )
      }
      source = source.replace(
        traverseRequire,
        `require(${JSON.stringify(require.resolve("@babel/traverse"))})`,
      )
    }
    writeFileSync(join(destination, file), source)
  }
  const entry = join(destination, "entry.ts")
  writeFileSync(
    entry,
    `export { default as deadCodeElimination } from './src/dead-code-elimination';\nexport { default as findReferencedIdentifiers } from './src/find-referenced-identifiers';\nexport * from './src/find-referenced-identifiers';\nexport { default as findRemovableBindings } from './src/find-removable-bindings';\nexport { parse, traverse, t } from './src/babel-esm';\nimport generator from '@babel/generator';\nexport const generate = generator.default ?? generator;\n`,
  )
  const output = join(destination, "index.mjs")
  await esbuild.build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    plugins: [
      {
        name: "shared-dependencies",
        setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, (args) => ({
            path: args.path.startsWith("node:")
              ? args.path
              : require.resolve(args.path),
            external: true,
          }))
        },
      },
    ],
  })
  prepared.push({
    name: variant.name,
    ref: variant.ref,
    commit: variant.commit,
    sourceHashes,
    bundle: output,
    bundleSha256: hash(readFileSync(output)),
  })
}
const babel = Object.fromEntries(
  ["core", "parser", "traverse", "types", "generator"].map((name) => {
    const path = require.resolve(`@babel/${name}`)
    return [
      `@babel/${name}`,
      {
        path,
        sha256: hash(readFileSync(path)),
        version: require(`@babel/${name}/package.json`).version,
      },
    ]
  }),
)
const manifest = {
  node: process.version,
  esbuild: esbuild.version,
  babel,
  variants: prepared,
}
writeFileSync(
  join(outputRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
)
console.log(JSON.stringify(manifest, null, 2))
