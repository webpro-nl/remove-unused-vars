import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const cli = fileURLToPath(new URL('../index.js', import.meta.url));
const biome = fileURLToPath(new URL('../node_modules/@biomejs/biome/bin/biome', import.meta.url));

test('Biome named import group: preserves a used default and side-effect import', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'remove-unused-vars-imports-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'input.mjs');
  const source = [
    'import kept, { a, b } from "./values.mjs";',
    'import "./effect.mjs";',
    'console.log(JSON.stringify([kept, globalThis.importEffect]));',
    '',
  ].join('\n');
  writeFileSync(filePath, source);
  writeFileSync(path.join(directory, 'values.mjs'), 'export default 42; export const a = 1, b = 2;\n');
  writeFileSync(path.join(directory, 'effect.mjs'), 'globalThis.importEffect = 7;\n');

  const lint = spawnSync(
    process.execPath,
    [biome, 'lint', '--only', 'correctness/noUnusedImports', '--reporter', 'json', filePath],
    { encoding: 'utf8', timeout: 10000 },
  );
  assert.equal(lint.status, 0, lint.stderr);
  const report = JSON.parse(lint.stdout);
  t.diagnostic(`Biome report: ${lint.stdout.trim()}`);
  assert.equal(report.diagnostics.length, 1);
  assert.equal(report.diagnostics[0].category, 'lint/correctness/noUnusedImports');
  assert.deepEqual(report.diagnostics[0].location.start, { line: 1, column: 14 });
  assert.equal(source[report.diagnostics[0].location.start.column - 1], '{');

  const result = spawnSync(process.execPath, [cli], { input: lint.stdout, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const processed = readFileSync(filePath, 'utf8');
  const parsed = ts.createSourceFile(filePath, processed, ts.ScriptTarget.Latest, true);
  assert.deepEqual(parsed.parseDiagnostics, []);
  const imports = parsed.statements.filter(ts.isImportDeclaration);
  assert.equal(imports[0].importClause.name.text, 'kept');
  assert.equal(imports[0].importClause.namedBindings?.getText(), undefined, 'unused named import group must be removed');
  assert.equal(imports[1].getText(), 'import "./effect.mjs";');

  const consumer = spawnSync(process.execPath, [filePath], { encoding: 'utf8', timeout: 10000 });
  assert.equal(consumer.status, 0, consumer.stderr);
  assert.deepEqual(JSON.parse(consumer.stdout), [42, 7]);
});

const cases = [
  {
    name: 'keeps the default separated from from in a compact import',
    input: 'import kept,{a,b}from"./values.mjs";',
    expected: 'import kept from"./values.mjs";',
    value: 'kept',
    runtime: [42, 7, 1],
    target: '{',
  },
  {
    name: 'preserves a comment after an unused named import group',
    input: 'import kept,{a,b}/* source */from"./values.mjs";',
    expected: 'import kept /* source */from"./values.mjs";',
    value: 'kept',
    runtime: [42, 7, 1],
    target: '{',
  },
  {
    name: 'preserves a newline after an unused named import group',
    input: 'import kept,{a,b}\nfrom"./values.mjs";',
    expected: 'import kept\nfrom"./values.mjs";',
    value: 'kept',
    runtime: [42, 7, 1],
    target: '{',
  },
  {
    name: 'removes an unused named-only import',
    input: 'import { a, b } from "./values.mjs";',
    expected: '',
    value: '0',
    runtime: [0, 7, 0],
    target: '{',
  },
  {
    name: 'removes an unused import type',
    input: 'import type { A, B } from "./types.ts";',
    expected: '',
    value: '0',
    runtime: [0, 7, 0],
    target: '{',
    typescript: true,
  },
  {
    name: 'preserves a default with comments, aliases and a trailing comma in the unused group',
    input: 'import kept /* comma, */ , /* separator, */ {\n  a as unusedA,\n  b,\n} from "./values.mjs";',
    expected: 'import kept from "./values.mjs";',
    value: 'kept',
    runtime: [42, 7, 1],
    target: '{',
  },
  {
    name: 'removes an unused default import',
    input: 'import unused from "./values.mjs";',
    expected: '',
    value: '0',
    runtime: [0, 7, 0],
    target: 'u',
  },
  {
    name: 'removes an unused namespace import',
    input: 'import * as unused from "./values.mjs";',
    expected: '',
    value: '0',
    runtime: [0, 7, 0],
    target: 'u',
  },
  {
    name: 'removes a wholly unused mixed import',
    input: 'import unused, { a, b } from "./values.mjs";',
    expected: '',
    value: '0',
    runtime: [0, 7, 0],
    target: 'u',
  },
  {
    name: 'preserves a used named binding',
    input: 'import { a, b } from "./values.mjs";',
    expected: 'import { a } from "./values.mjs";',
    value: 'a',
    runtime: [1, 7, 1],
    target: 'b',
  },
  {
    name: 'preserves an empty import and its effects',
    input: 'import {} from "./values.mjs";',
    expected: 'import {} from "./values.mjs";',
    value: '0',
    runtime: [0, 7, 1],
    target: '}',
  },
  {
    name: 'preserves a side-effect-only import',
    input: 'import "./values.mjs";',
    expected: 'import "./values.mjs";',
    value: '0',
    runtime: [0, 7, 1],
  },
];

for (const fixture of cases) {
  test(`Biome import compatibility: ${fixture.name}`, t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'remove-unused-vars-imports-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, fixture.typescript ? 'input.ts' : 'input.mjs');
    const tail = [
      '',
      'import "./effect.mjs";',
      `console.log(JSON.stringify([${fixture.value}, globalThis.importEffect, globalThis.valuesLoads ?? 0]));`,
      '',
    ].join('\n');
    const source = fixture.input + tail;
    writeFileSync(filePath, source);
    writeFileSync(
      path.join(directory, 'values.mjs'),
      'globalThis.valuesLoads = (globalThis.valuesLoads ?? 0) + 1;\nexport default 42; export const a = 1, b = 2;\n',
    );
    writeFileSync(path.join(directory, 'effect.mjs'), 'globalThis.importEffect = 7;\n');
    writeFileSync(path.join(directory, 'types.ts'), 'export type A = string; export type B = number;\n');

    const lint = spawnSync(
      process.execPath,
      [biome, 'lint', '--only', 'correctness/noUnusedImports', '--reporter', 'json', filePath],
      { encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(lint.status, 0, lint.stderr);
    const report = JSON.parse(lint.stdout);
    t.diagnostic(`Biome report: ${lint.stdout.trim()}`);
    assert.equal(report.diagnostics.length, fixture.target ? 1 : 0);
    if (fixture.target) {
      const diagnostic = report.diagnostics[0];
      assert.equal(diagnostic.category, 'lint/correctness/noUnusedImports');
      const { line, column } = diagnostic.location.start;
      assert.equal(source.split('\n')[line - 1][column - 1], fixture.target);
    }

    const result = spawnSync(process.execPath, [cli], { input: lint.stdout, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const processed = readFileSync(filePath, 'utf8');
    assert.equal(processed, fixture.expected + tail);
    const parsed = ts.createSourceFile(filePath, processed, ts.ScriptTarget.Latest, true);
    assert.deepEqual(parsed.parseDiagnostics, []);

    const consumerPath = path.join(directory, 'consumer.mjs');
    if (fixture.typescript) {
      const compiled = ts.transpileModule(processed, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
      });
      assert.deepEqual(compiled.diagnostics, []);
      writeFileSync(consumerPath, compiled.outputText);
    } else {
      writeFileSync(consumerPath, processed);
    }
    const consumer = spawnSync(process.execPath, [consumerPath], { encoding: 'utf8', timeout: 10000 });
    assert.equal(consumer.status, 0, consumer.stderr);
    assert.deepEqual(JSON.parse(consumer.stdout), fixture.runtime);
  });
}
