import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';

const cli = fileURLToPath(new URL('../index.js', import.meta.url));
const config = fileURLToPath(new URL('../fixtures/eslint.config.js', import.meta.url));
const prelude = 'async function run(callback) { console.log(await callback(1, 2)); }\n';
const cases = [
  { name: 'bare call', input: 'await run(unused => 42);', output: 'await run( () => 42);' },
  { name: 'bare standalone', input: 'const fn = unused => 42; await run(fn);', output: 'const fn = () => 42; await run(fn);' },
  { name: 'bare wrapper', input: 'await run((unused => 42));', output: 'await run(( () => 42));' },
  { name: 'nested wrappers', input: 'await run((((unused => 42))));', output: 'await run(((( () => 42))));' },
  { name: 'parenthesized call', input: 'await run((unused) => 42);', output: 'await run(() => 42);' },
  { name: 'parenthesized wrapper', input: 'await run((((unused) => 42)));', output: 'await run(((() => 42)));' },
  { name: 'async bare', input: 'await run(async unused => 42);', output: 'await run(async () => 42);' },
  { name: 'async parenthesized', input: 'await run((async (unused) => 42));', output: 'await run((async () => 42));' },
  {
    name: 'bare block comments with commas and parentheses',
    input: 'await run(/* (, */ unused /* ), */ => 42);',
    output: 'await run( () /* ), */ => 42);',
  },
  {
    name: 'parenthesized block comments with commas',
    input: 'await run((/* (, */ unused /* ), */) => 42);',
    output: 'await run(( /* ), */) => 42);',
  },
  {
    name: 'bare line comment',
    input: 'await run(// (,\nunused => 42);',
    output: 'await run( () => 42);',
  },
  {
    name: 'async comment',
    input: 'await run(async /* (, */ unused /* ), */ => 42);',
    output: 'await run(async () /* ), */ => 42);',
  },
  {
    name: 'multiple independent intervals',
    input: 'await run(unused => 42); await run((other) => 43); await run((async third => 44));',
    output: 'await run( () => 42); await run(() => 43); await run((async () => 44));',
    names: ['unused', 'other', 'third'],
    stdout: '42\n43\n44\n',
  },
  {
    name: 'whole unused arrow declaration',
    input: 'const unusedArrow = unused => 0; console.log(42);',
    output: ' console.log(42);',
    names: ['unusedArrow', 'unused'],
  },
  {
    name: 'whole unused destructuring declaration',
    input: 'const { unused, other } = { unused: 1, other: 2 }; console.log(42);',
    output: ' console.log(42);',
    names: ['unused', 'other'],
  },
  { name: 'ordinary function', input: 'await run(function (unused) { return 42; });', output: 'await run(function () { return 42; });' },
  { name: 'all parameters unused', input: 'await run((unused, other) => 42);', output: 'await run(() => 42);', names: ['unused', 'other'] },
  { name: 'trailing unused parameter', input: 'await run((used, unused) => used + 41);', output: 'await run((used,) => used + 41);' },
  {
    name: 'leading unused parameter stays positional',
    input: 'await run((unused, used) => used + 40);',
    output: 'await run((unused, used) => used + 40);',
    preserved: true,
  },
  {
    name: 'used sole parameter',
    input: 'await run(used => used + 41);',
    output: 'await run(used => used + 41);',
    names: [],
    preserved: true,
  },
  {
    name: 'write-only assignment remains',
    input: 'export function kept() { let writeOnly = 1; writeOnly = 2; return 42; } console.log(kept());',
    output: 'export function kept() { let writeOnly = 1; writeOnly = 2; return 42; } console.log(kept());',
    names: ['writeOnly'],
    preserved: true,
  },
];

function execute(source, directory, typed) {
  const filePath = path.join(directory, 'consumer.mjs');
  const output = typed
    ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    : source;
  writeFileSync(filePath, output);
  const result = spawnSync(process.execPath, [filePath], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

async function check(t, ruleId, fixture, typed = false) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ruv-arrow-boundaries-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Declaration-removal controls stand alone so unrelated diagnostics cannot mask their result.
  const prefix = fixture.input.includes('await run(') ? prelude : '';
  const source = prefix + fixture.input + '\n';
  const filePath = path.join(directory, typed ? 'input.ts' : 'input.js');
  writeFileSync(filePath, source);
  const expectedStdout = fixture.stdout ?? '42\n';
  assert.equal(execute(source, directory, typed), expectedStdout, 'original consumer');

  const eslint = new ESLint({
    cwd: directory,
    overrideConfigFile: config,
    overrideConfig: {
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        [ruleId]: ['error', { args: 'all' }],
      },
    },
  });
  const results = await eslint.lintFiles([filePath]);
  assert.equal(results.length, 1);
  const messages = results[0].messages;
  const names = fixture.names ?? ['unused'];
  assert.equal(messages.length, names.length, JSON.stringify(messages));
  assert.deepEqual(messages.map(message => {
    assert.equal(message.ruleId, ruleId);
    assert.equal(message.messageId, 'unusedVar');
    const line = source.split('\n')[message.line - 1];
    return line.slice(message.column - 1, message.endColumn - 1);
  }), names);
  if (fixture.name === 'write-only assignment remains') {
    assert.equal(messages[0].column, source.indexOf('writeOnly = 2') + 1);
  }

  // Pass the real formatter output unchanged, including suggestions and source, to the CLI.
  const formatter = await eslint.loadFormatter('json');
  const report = await formatter.format(results);
  const result = spawnSync(process.execPath, [cli], { input: report, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const transformed = readFileSync(filePath, 'utf8');
  assert.equal(execute(transformed, directory, typed), expectedStdout, 'transformed consumer');
  assert.equal(transformed, prefix + fixture.output + '\n');
  if (fixture.preserved) assert.equal(transformed, source);
  else {
    for (const name of names) assert.doesNotMatch(transformed, new RegExp(`\\b${name}\\b`));
  }
}

for (const ruleId of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  for (const fixture of cases) {
    test(`${ruleId}: ${fixture.name}`, { timeout: 30_000 }, t => check(t, ruleId, fixture));
  }
}

test('@typescript-eslint/no-unused-vars: typed parenthesized arrow', { timeout: 30_000 }, t =>
  check(t, '@typescript-eslint/no-unused-vars', {
    input: 'await run((unused: number): number => 42);',
    output: 'await run((): number => 42);',
  }, true),
);
