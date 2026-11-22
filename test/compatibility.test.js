import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyReport } from '../rewrite.js';

function runReport(t, source, createReport, fileName = 'input.js') {
  const directory = mkdtempSync(path.join(tmpdir(), 'remove-unused-vars-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, fileName);
  writeFileSync(filePath, source);
  applyReport(createReport(filePath));
  return readFileSync(filePath, 'utf8');
}

// The matrix's ESLint runners use args: 'after-used'; these reports also flag earlier unused parameters.
const listSeparatorParameterCases = [
  {
    name: 'used later argument retains earlier unused argument',
    source: 'function run(unused /* keep, comment */, kept,) { console.log(kept); } run(0, 42);',
    columns: [14],
    expected: 'function run(unused /* keep, comment */, kept,) { console.log(kept); } run(0, 42);',
  },
  {
    name: 'used middle argument with both neighbors reported',
    source: 'function run(unusedA, kept, unusedB /* keep, comment */,) { console.log(kept); } run(0, 42, 1);',
    columns: [14, 29],
    expected: 'function run(unusedA, kept, /* keep, comment */) { console.log(kept); } run(0, 42, 1);',
  },
  {
    name: 'used rest parameter retains earlier unused argument',
    source: 'function run(unused /* keep, comment */, ...kept) { console.log(kept[0]); } run(0, 42);',
    columns: [14],
    expected: 'function run(unused /* keep, comment */, ...kept) { console.log(kept[0]); } run(0, 42);',
  },
];

for (const ruleId of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  for (const fixture of listSeparatorParameterCases) {
    test(`${ruleId} list separators: ${fixture.name}`, t => {
      const actual = runReport(t, fixture.source, filePath => [
        {
          filePath,
          messages: fixture.columns.map(column => ({ ruleId, line: 1, column })),
        },
      ]);
      assert.equal(actual, fixture.expected);
    });
  }
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

for (const typed of [false, true]) {
  const ruleId = typed ? '@typescript-eslint/no-unused-vars' : 'no-unused-vars';
  const annotation = typed ? ': number' : '';
  const ignoredBindingCases = [
    {
      name: 'used ignored variable',
      source: 'const _used = 42;\nconsole.log(_used);\n',
      expected: 'const _used = 42;\nconsole.log(_used);\n',
      messages: [{ messageId: 'usedIgnoredVar', line: 1, column: 7 }],
    },
    {
      name: 'used ignored parameter',
      source: `function answer(_used${annotation}) { return _used; }\nconsole.log(answer(42));\n`,
      expected: `function answer(_used${annotation}) { return _used; }\nconsole.log(answer(42));\n`,
      messages: [{ messageId: 'usedIgnoredVar', line: 1, column: 17 }],
    },
    {
      name: 'used ignored catch binding',
      source: 'try { throw 42; } catch (_used) { console.log(_used); }\n',
      expected: 'try { throw 42; } catch (_used) { console.log(_used); }\n',
      messages: [{ messageId: 'usedIgnoredVar', line: 1, column: 26 }],
    },
    {
      name: 'used ignored array binding',
      source: 'const [_used] = [42];\nconsole.log(_used);\n',
      expected: 'const [_used] = [42];\nconsole.log(_used);\n',
      messages: [{ messageId: 'usedIgnoredVar', line: 1, column: 8 }],
    },
    {
      name: 'used ignored variable alongside an unused variable',
      source: 'const _used = 42;\nconst unused = 0;\nconsole.log(_used);\n',
      expected: 'const _used = 42;\nconsole.log(_used);\n',
      messages: [
        { messageId: 'usedIgnoredVar', line: 1, column: 7 },
        {
          messageId: 'unusedVar',
          line: 2,
          column: 7,
          suggestions: typed ? undefined : [{ data: { varName: 'unused' }, fix: { range: [18, 35], text: '' } }],
        },
      ],
    },
    {
      name: 'used ignored parameter alongside an unused parameter',
      source: `function answer(_used${annotation}, unused${annotation}) { return _used; }\nconsole.log(answer(42));\n`,
      expected: `function answer(_used${annotation},) { return _used; }\nconsole.log(answer(42));\n`,
      messages: [
        { messageId: 'usedIgnoredVar', line: 1, column: 17 },
        {
          messageId: 'unusedVar',
          line: 1,
          column: typed ? 32 : 24,
          suggestions: typed ? undefined : [{ data: { varName: 'unused' }, fix: { range: [21, 29], text: '' } }],
        },
      ],
    },
  ];

  for (const fixture of ignoredBindingCases) {
    test(`${ruleId}: ${fixture.name}`, t => {
      const actual = runReport(t, fixture.source, filePath => [
        {
          filePath,
          source: fixture.source,
          messages: fixture.messages.map(message => ({ ...message, ruleId })),
        },
      ]);
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
    name: 'a partial range removes unreferenced bindings and preserves a used alias',
    source:
      '/* café 🎉 */ import unused, { unused as retiré, kept as gardé } from "./values.mjs";\nconsole.log(gardé);\n',
    span: [24, 51],
    expected:
      '/* café 🎉 */ import  {  kept as gardé } from "./values.mjs";\nconsole.log(gardé);\n',
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

test('import clauses: preserves the classic JSX factory in a current Biome partial range', t => {
  const source = "import { useState, default as React, useEffect } from 'react';\nexport const view = <div />;\n";
  const actual = runReport(
    t,
    source,
    filePath => ({
      diagnostics: [
        {
          category: 'lint/correctness/noUnusedImports',
          location: { path: filePath, start: { line: 1, column: 10 }, end: { line: 1, column: 47 } },
        },
      ],
    }),
    'input.tsx',
  );
  assert.equal(actual, "import {  default as React, useEffect } from 'react';\nexport const view = <div />;\n");
});

for (const [name, body, fileName] of [
  ['a JSX element', 'export const view = <div>{kept}</div>;', 'input.jsx'],
  ['a JSX fragment', 'export const view = <>{kept}</>;', 'input.tsx'],
]) {
  for (const format of ['legacy', 'current']) {
    test(`import clauses: ${format} partial ranges keep later bindings next to ${name}`, t => {
      const source = `import { unused, Hidden, kept, other } from './values.mjs';\n${body}\n`;
      const actual = runReport(
        t,
        source,
        filePath => ({
          diagnostics: [
            {
              category: 'lint/correctness/noUnusedImports',
              location:
                format === 'legacy'
                  ? { path: { file: filePath }, sourceCode: source, span: [9, 36] }
                  : { path: filePath, start: { line: 1, column: 10 }, end: { line: 1, column: 37 } },
            },
          ],
        }),
        fileName,
      );
      assert.equal(actual, `import {  Hidden, kept, other } from './values.mjs';\n${body}\n`);
    });
  }
}

for (const [name, body] of [
  ['a parameter type', '/** @param {Kept} value */\nexport function read(value) { return value.value; }'],
  ['a variable type', '/** @type {Kept} */\nexport let value;'],
  ['a documentation link', '/** See {@link Kept}. */\nexport const value = 1;'],
]) {
  test(`import clauses: partial ranges preserve JSDoc names in ${name}`, t => {
    const source = `import { unused, Kept, other } from './values.mjs';\n${body}\n`;
    const actual = runReport(t, source, filePath => ({
      diagnostics: [
        {
          category: 'lint/correctness/noUnusedImports',
          location: { path: filePath, start: { line: 1, column: 10 }, end: { line: 1, column: 29 } },
        },
      ],
    }));
    assert.equal(actual, `import {  Kept  } from './values.mjs';\n${body}\n`);
  });
}

test('import clauses: whole-clause ranges still remove unused imports next to JSX', t => {
  const source = "import unused, { other } from './values.mjs';\nexport const view = <div />;\n";
  const actual = runReport(t, source, filePath => ({
    diagnostics: [
      {
        category: 'lint/correctness/noUnusedImports',
        location: { path: filePath, start: { line: 1, column: 8 }, end: { line: 1, column: 25 } },
      },
    ],
  }));
  assert.equal(actual, '\nexport const view = <div />;\n');
});

// The matrix uses args: 'after-used', so ESLint does not report a leading parameter before a used one.
for (const ruleId of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  test(`${ruleId}: preserves a reported leading arrow parameter`, t => {
    const source = 'export const kept = (unused, used) => used + 40;\n';
    const actual = runReport(t, source, filePath => [
      {
        filePath,
        source,
        messages: [
          {
            ruleId,
            line: 1,
            column: 22,
            suggestions:
              ruleId === 'no-unused-vars'
                ? [{ data: { varName: 'unused' }, fix: { range: [21, 28], text: '' } }]
                : undefined,
          },
        ],
      },
    ]);
    assert.equal(actual, 'export const kept = (unused, used) => used + 40;\n');
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

// The matrix normalizes whitespace, so these cases check the directive and line endings exactly.
const shebangCases = [
  {
    name: 'CRLF directive',
    source: '#!/usr/bin/env node\r\nconst unused = 1;\r\nconsole.log(42);\r\n',
    expected: '#!/usr/bin/env node\r\n\r\nconsole.log(42);\r\n',
    column: 7,
  },
  {
    name: 'last import without final newline',
    source: '#!/usr/bin/env node\nimport unused from "./values.mjs";',
    expected: '#!/usr/bin/env node\n',
    column: 8,
  },
];

for (const ruleId of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  for (const fixture of shebangCases) {
    test(`shebang ${ruleId}: ${fixture.name}`, t => {
      const actual = runReport(t, fixture.source, filePath => [
        {
          filePath,
          messages: [{ ruleId, line: 2, column: fixture.column }],
        },
      ]);
      assert.equal(actual, fixture.expected);
    });
  }
}

test('shebang: preserves executable permissions', async t => {
  const { chmodSync, statSync } = await import('node:fs');
  let file;
  let originalMode;
  const actual = runReport(t, '#!/usr/bin/env node\nconst unused = 1;\nconsole.log(42);\n', filePath => {
    file = filePath;
    chmodSync(file, 0o755);
    originalMode = statSync(file).mode;
    return [{ filePath, messages: [{ ruleId: 'no-unused-vars', line: 2, column: 7 }] }];
  });
  assert.equal(actual, '#!/usr/bin/env node\n\nconsole.log(42);\n');
  assert.equal(statSync(file).mode, originalMode);
});
