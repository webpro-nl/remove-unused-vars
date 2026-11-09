import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../index.js', import.meta.url));

function runReport(t, source, createReport) {
  const directory = mkdtempSync(path.join(tmpdir(), 'remove-unused-vars-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'input.js');
  writeFileSync(filePath, source);
  const result = spawnSync(process.execPath, [cli], {
    input: JSON.stringify(createReport(filePath)),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(filePath, 'utf8');
}

const biomeCases = [
  {
    name: 'variables',
    category: 'lint/correctness/noUnusedVariables',
    source: 'const unused = 1;\nexport const kept = 2;\n',
    expected: '\nexport const kept = 2;\n',
    span: [6, 12],
    start: { line: 1, column: 7 },
  },
  {
    name: 'imports',
    category: 'lint/correctness/noUnusedImports',
    source: 'import unused from "mod";\nexport const kept = 2;\n',
    expected: '\nexport const kept = 2;\n',
    span: [7, 13],
    start: { line: 1, column: 8 },
  },
  {
    name: 'parameters',
    category: 'lint/correctness/noUnusedFunctionParameters',
    source: 'export function kept(unused) { return 1; }\n',
    expected: 'export function kept() { return 1; }\n',
    span: [21, 27],
    start: { line: 1, column: 22 },
  },
  {
    name: 'Unicode before a binding on the same line',
    category: 'lint/correctness/noUnusedFunctionParameters',
    source: 'export function kept(a = "🎉🎉🎉🎉🎉🎉 café", unused) { return a; }\n',
    expected: 'export function kept(a = "🎉🎉🎉🎉🎉🎉 café",) { return a; }\n',
    span: [59, 65],
    start: { line: 1, column: 41 },
  },
];

for (const format of ['legacy', 'current']) {
  for (const fixture of biomeCases) {
    test(`Biome ${format} report: ${fixture.name}`, t => {
      const actual = runReport(t, fixture.source, filePath => ({
        diagnostics: [
          {
            category: fixture.category,
            location:
              format === 'legacy'
                ? { path: { file: filePath }, sourceCode: fixture.source, span: fixture.span }
                : { path: filePath, start: fixture.start },
          },
        ],
      }));
      assert.equal(actual, fixture.expected);
    });
  }
}

const biomeLegacyImportCases = [
  {
    name: 'an unused mixed import across CRLF',
    source: '/* café 🎉 */ import unused, /* café 🎉 */\r\n * as namespace from "./values.mjs";\nconsole.log(0);\n',
    span: [24, 65],
    expected: '\nconsole.log(0);\n',
  },
  {
    name: 'an unused named group after a used default',
    source: '/* café 🎉 */ import kept, { unused } from "./values.mjs";\nconsole.log(kept);\n',
    span: [30, 40],
    expected: '/* café 🎉 */ import kept  from "./values.mjs";\nconsole.log(kept);\n',
  },
  {
    name: 'an unused default before a used namespace',
    source:
      '/* café 🎉 */ import unused, /* café 🎉 */ * as namespace from "./values.mjs";\nconsole.log(namespace.kept);\n',
    span: [24, 30],
    expected:
      '/* café 🎉 */ import  /* café 🎉 */ * as namespace from "./values.mjs";\nconsole.log(namespace.kept);\n',
  },
  {
    name: 'a partial range removes only the binding at its start',
    source:
      '/* café 🎉 */ import unused, { unused as retiré, kept as gardé } from "./values.mjs";\nconsole.log(gardé);\n',
    span: [24, 51],
    expected:
      '/* café 🎉 */ import  { unused as retiré, kept as gardé } from "./values.mjs";\nconsole.log(gardé);\n',
  },
];

for (const fixture of biomeLegacyImportCases) {
  test(`Biome legacy report: ${fixture.name}`, t => {
    const actual = runReport(t, fixture.source, filePath => ({
      diagnostics: [
        {
          category: 'lint/correctness/noUnusedImports',
          location: { path: { file: filePath }, sourceCode: fixture.source, span: fixture.span },
        },
      ],
    }));
    assert.equal(actual, fixture.expected);
  });
}

for (const [name, separator, start] of [
  ['LF', '\n', { line: 2, column: 7 }],
  ['CRLF', '\r\n', { line: 2, column: 7 }],
  ['CR', '\r', { line: 2, column: 7 }],
  ['line separator', '\u2028', { line: 1, column: 32 }],
  ['paragraph separator', '\u2029', { line: 1, column: 32 }],
]) {
  test(`Biome current report: ${name} before a binding`, t => {
    const source = `export const kept = "🎉";${separator}const unused = 1;\n`;
    const actual = runReport(t, source, filePath => ({
      diagnostics: [
        {
          category: 'lint/correctness/noUnusedVariables',
          location: { path: filePath, start },
        },
      ],
    }));
    assert.equal(actual, 'export const kept = "🎉";\n');
  });
}

// The matrix lints one file at a time and cannot control cross-file diagnostic order.
for (const order of ['before', 'after']) {
  test(`Oxlint report: parser error ${order} unused diagnostics`, t => {
    const source = `const unused = 1;
const { first, /* punctuation, stays inside this declaration */ second } = { first: 1, second: 2 };
export function kept(value) {
  let pending = 0;
  pending = value;
  return value * 2;
}
console.log(kept(21));
`;
    let brokenPath;
    const actual = runReport(t, source, filePath => {
      brokenPath = path.join(path.dirname(filePath), 'broken.js');
      writeFileSync(brokenPath, 'const broken = ;\n');
      const parserError = {
        message: 'Unexpected token',
        severity: 'error',
        filename: brokenPath,
        labels: [{ span: { offset: 15, length: 1, line: 1, column: 16 } }],
      };
      const unused = [
        [6, 6],
        [26, 5],
        [82, 6],
        [154, 7],
      ].map(([offset, length]) => ({
        code: 'eslint(no-unused-vars)',
        filename: filePath,
        labels: [{ span: { offset, length } }],
      }));
      return { diagnostics: order === 'before' ? [parserError, ...unused] : [...unused, parserError] };
    });
    assert.equal(
      actual,
      `
export function kept(value) {
  let pending = 0;
  pending = value;
  return value * 2;
}
console.log(kept(21));
`,
    );
    assert.equal(readFileSync(brokenPath, 'utf8'), 'const broken = ;\n');
  });
}

// The matrix does not enable debugger rules.
for (const [name, createReport] of [
  ['ESLint', filePath => [{ filePath, messages: [{ ruleId: 'no-debugger', line: 1, column: 1 }] }]],
  [
    'Biome',
    filePath => ({
      diagnostics: [
        { category: 'lint/suspicious/noDebugger', location: { path: filePath, start: { line: 1, column: 1 } } },
      ],
    }),
  ],
  [
    'Oxlint',
    filePath => ({
      diagnostics: [{ code: 'eslint(no-debugger)', filename: filePath, labels: [{ span: { offset: 0, length: 9 } }] }],
    }),
  ],
]) {
  test(`${name} unrelated rule leaves source unchanged`, t => {
    const actual = runReport(t, 'debugger;\nconsole.log(42);\n', createReport);
    assert.equal(actual, 'debugger;\nconsole.log(42);\n');
  });
}

for (const [name, report] of [
  ['ESLint', []],
  ['Biome', { summary: {}, diagnostics: [], command: 'lint' }],
  ['oxlint', { diagnostics: [], number_of_files: 1, number_of_rules: 1 }],
]) {
  test(`${name} empty report leaves source unchanged`, t => {
    const actual = runReport(t, 'export const kept = 1;\n', () => report);
    assert.equal(actual, 'export const kept = 1;\n');
  });
}
