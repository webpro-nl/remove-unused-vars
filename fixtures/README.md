# Rewrite fixtures

To add a case, create `fixtures/<topic>/<case>/` with an `input` file and its expected `output` with the same extension, such as `input.ts` and `output.ts`. Name the case after the behavior it checks. The matrix runs it with ESLint, typescript-eslint, Biome and Oxlint. Cases where linters report different bindings or produce different output have entries in `fixtureOptions` in [the matrix runner](../test/matrix.test.js).

For each linter, the matrix sends the fixture marked `cli` through the executable on stdin. It lints the remaining inputs together, applies the report to temporary copies, and checks each rewritten file against its own expected output.

Select a case from the repository root using its topic and case name, with hyphens replaced by spaces.

```sh
node --test --test-name-pattern='statement boundaries: unbraced if before array' test/matrix.test.js
```

For behavior that needs a specific JSON report, such as legacy Biome offsets or the order of Oxlint diagnostics, see the [compatibility tests](../test/compatibility.test.js). The [reporter-shape tests](../test/reporter-shapes.test.js) also exercise passing a report file to the CLI.
