# Benchmarks

Benchmarks use [Vitest benchmarking](https://vitest.dev/guide/benchmarking.html)
(tinybench). Workloads live in `workloads.ts`:

- realistic TS/JSX route modules in `corpus/` with consumer-style transforms:
  React Router loader/action stripping (`rr-*`), TanStack Start server
  function stubbing (`tsr-*`) and TanStack Router code splitting
  (`tsr-admin-split`)
- synthetic stress modules (dead schemas, reference chains, many imports,
  destructuring patterns, a tiny module)

| File                                   | Measures                                                       |
| -------------------------------------- | -------------------------------------------------------------- |
| `pipeline.bench.ts`                    | parse, reference analysis, transform, elimination, generation  |
| `dead-code-elimination.bench.ts`       | elimination after the transform, and on a freshly parsed AST   |
| `find-referenced-identifiers.bench.ts` | reference analysis on fresh and already scoped ASTs, collector |
| `find-removable-bindings.bench.ts`     | the binding graph and cycle analysis                           |

Operations that mutate an AST get a fresh input per iteration, prepared
outside the timed loop (`consuming.ts`).

## Compare a change against a baseline

```sh
pnpm bench:baseline                               # on the base commit
pnpm bench --compare benchmarks/baseline.json      # on the change
```

`benchmarks/baseline.json` holds the committed baseline, with file paths
relative to the repository. Run benchmarks
sequentially on an otherwise idle machine; results from different machines
are not comparable. Compare a baseline against itself once to see the noise
level before trusting small differences.

## Output parity

Performance changes must not change output. `corpus.test.ts` snapshots the
output of every workload (`pnpm test`).
