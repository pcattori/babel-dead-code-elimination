import cases from "./07-cleanup.mjs"
export default [
  {
    ...cases.find(
      (fixture) => fixture.name === "candidate-filtered-128-variables",
    ),
    iterations: 128,
  },
]
