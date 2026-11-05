import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import ts from 'typescript';

const cli = fileURLToPath(new URL('../index.js', import.meta.url));
const consumer = '\nconsole.log(42);\n';
const cases = [
  ...['const msg = "msg";', 'function msg() { return "msg"; }'].map((statement, index) => ({
    name: 'executable shebang before ' + (index === 0 ? 'variable' : 'function'),
    source: '#!/usr/bin/env node\n' + statement + consumer,
    expected: '#!/usr/bin/env node\n' + consumer,
    executable: true,
    broad: true,
  })),
  {
    name: 'BOM before compact first-line import',
    source: '\uFEFFimport{readFile}from"node:fs";' + consumer,
    expected: consumer,
  },
  {
    name: 'BOM before an earlier line',
    source: '\uFEFFconsole.log("start");\nconst msg = "msg";' + consumer,
    expected: '\uFEFFconsole.log("start");' + consumer,
    stdout: 'start\n42\n',
  },
  ...['\u2028', '\u2029'].map(separator => ({
    name: 'Unicode line separator ' + separator.charCodeAt(0).toString(16),
    source: 'console.log("start");' + separator + 'const msg = "msg";' + consumer,
    expected: 'console.log("start");' + consumer,
    stdout: 'start\n42\n',
  })),
  { name: 'same-name literal', source: 'const msg = "msg";' + consumer, expected: consumer, broad: true },
  { name: 'literal substring', source: 'const msg = "prefix-msg-suffix";' + consumer, expected: consumer, broad: true },
  { name: 'property', source: 'const msg = { msg: 42 };' + consumer, expected: consumer, broad: true },
  { name: 'comment', source: 'const msg = /* msg */ 42;' + consumer, expected: consumer, broad: true },
  {
    name: 'identifier substring',
    source: 'const msgValue = 42;\nconst msg = msgValue;\nconsole.log(msgValue);\n',
    expected: 'const msgValue = 42;\nconsole.log(msgValue);\n',
    broad: true,
  },
  {
    name: 'Unicode and CRLF before binding',
    source: 'console.log("🎉");\r\nconst msg = "msg";\r\nconsole.log(42);\r\n',
    expected: 'console.log("🎉");\r\nconsole.log(42);\r\n',
    stdout: '🎉\n42\n',
    broad: true,
  },
  {
    name: 'object destructuring default',
    source: 'const { msg = "msg", kept } = { kept: 42 };\nconsole.log(kept);\n',
    expected: 'const { kept } = { kept: 42 };\nconsole.log(kept);\n',
  },
  {
    name: 'binding safety: object separator after a comment',
    source: 'const { msg = { msg: 0 } /* , */, kept } = { kept: 42 };\nconsole.log(kept);\n',
    expected: 'const { kept } = { kept: 42 };\nconsole.log(kept);\n',
  },
  {
    name: 'binding safety: property excluded from a used object rest',
    source: 'const { msg = { msg: 0 }, ...kept } = { msg: 7, value: 42 };\nconsole.log(JSON.stringify(kept));\n',
    stdout: '{"value":42}\n',
    unchanged: true,
  },
  {
    name: 'binding safety: unused object rest control',
    source: 'const { kept, ...msg } = { kept: 42 };\nconsole.log(kept);\n',
    expected: 'const { kept, } = { kept: 42 };\nconsole.log(kept);\n',
  },
  {
    name: 'binding safety: both property and rest are unused',
    source: 'const { msg = { msg: 0 }, kept, ...extra } = { kept: 42 };\nconsole.log(kept);\n',
    expected: 'const { kept, } = { kept: 42 };\nconsole.log(kept);\n',
    messageCount: 2,
  },
  {
    name: 'binding safety: parameter separator after a comment',
    source: 'function kept(msg = { msg: 0 } /* , */, other) { return 42; }\nconsole.log(kept());\n',
    expected: 'function kept() { return 42; }\nconsole.log(kept());\n',
    messageCount: 2,
  },
  {
    name: 'renamed object binding',
    source: 'const { value: msg = "msg", kept } = { kept: 42 };\nconsole.log(kept);\n',
    expected: 'const { kept } = { kept: 42 };\nconsole.log(kept);\n',
  },
  {
    name: 'leading array slot with same-name property in default',
    source: 'const [msg = { msg: 0 }, kept] = [7,42];\nconsole.log(kept);\n',
    expected: 'const [, kept] = [7,42];\nconsole.log(kept);\n',
  },
  {
    name: 'middle array slot with same-name property in default',
    source: 'const [head, msg = { msg: 0 }, kept] = [1,7,42];\nconsole.log(head, kept);\n',
    expected: 'const [head,, kept] = [1,7,42];\nconsole.log(head, kept);\n',
    stdout: '1 42\n',
  },
  {
    name: 'array slot before a used rest binding',
    source: 'const [msg = { msg: 0 }, ...kept] = [7,42];\nconsole.log(kept.join());\n',
    expected: 'const [, ...kept] = [7,42];\nconsole.log(kept.join());\n',
  },
  {
    name: 'trailing array binding',
    source: 'const [kept, msg = "msg"] = [42];\nconsole.log(kept);\n',
    expected: 'const [kept,] = [42];\nconsole.log(kept);\n',
  },
  {
    name: 'parameter default',
    source: 'function kept(msg = "msg") { return 42; }\nconsole.log(kept());\n',
    expected: 'function kept() { return 42; }\nconsole.log(kept());\n',
  },
  {
    name: 'catch binding',
    source: 'try { throw 1; } catch (msg) { console.log(42); }\n',
    expected: 'try { throw 1; } catch { console.log(42); }\n',
  },
  {
    name: 'write-only assignment without suggestion',
    source: 'let msg = "msg";\nmsg = "msg";' + consumer,
    unchanged: true,
    noSuggestion: true,
  },
  {
    name: 'write-only increment',
    source: 'let msg = 0;\nmsg++;' + consumer,
    unchanged: true,
  },
  {
    name: 'leading parameter policy',
    source: 'function kept(msg, value) { return value; }\nconsole.log(kept(1, 42));\n',
    unchanged: true,
  },
];

function run(args, input) {
  const result = spawnSync(process.execPath, args, { input, encoding: 'utf8', timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function executeFile(filePath) {
  const result = spawnSync(filePath, [], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// Execute emitted JavaScript on both Node 20 and Node 24, including TS-only input.
function execute(directory, source) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.length, 0);
  const file = path.join(directory, 'consumer.mjs');
  writeFileSync(file, compiled.outputText);
  return run([file]);
}

for (const ruleId of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  const typed = ruleId.startsWith('@');
  const linter = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.js', '**/*.ts'],
        languageOptions: typed ? { parser: tseslint.parser } : {},
        plugins: { '@typescript-eslint': tseslint.plugin },
        rules: { [ruleId]: ['error', { args: 'all', caughtErrors: 'all' }] },
      },
    ],
  });
  const fixtures = typed
    ? [
        ...cases,
        {
          name: 'typed literal without suggestion',
          source: 'const msg: string = "msg";' + consumer,
          expected: consumer,
          noSuggestion: true,
        },
      ]
    : cases;

  for (const fixture of fixtures) {
    test(`${ruleId}: diagnostic binding: ${fixture.name}`, async t => {
      const directory = mkdtempSync(path.join(tmpdir(), 'ruv-diagnostic-binding-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const filePath = path.join(directory, typed ? 'input.ts' : 'input.js');
      writeFileSync(filePath, fixture.source);
      const [report] = await linter.lintText(fixture.source, { filePath: typed ? 'input.ts' : 'input.js' });
      assert.equal(report.fatalErrorCount, 0);
      assert.equal(report.messages.length, fixture.messageCount ?? 1, JSON.stringify(report.messages));
      const [message] = report.messages;
      assert.equal(message.ruleId, ruleId);
      assert.equal(message.messageId, 'unusedVar');
      if (fixture.noSuggestion) assert.equal(message.suggestions, undefined);
      if (!typed && fixture.broad) {
        const suggestion = message.suggestions[0];
        assert.equal(suggestion.data.varName, 'msg');
        const fragment = fixture.source.slice(...suggestion.fix.range);
        assert.ok(fragment.indexOf('msg') !== fragment.lastIndexOf('msg'));
      }
      // Pass the producer's messages unchanged; only redirect its filename to our fixture.
      assert.equal(execute(directory, fixture.source), fixture.stdout ?? '42\n');
      const executable = fixture.executable && process.platform !== 'win32';
      if (executable) {
        chmodSync(filePath, 0o755);
        assert.equal(executeFile(filePath), '42\n');
      }
      run([cli], JSON.stringify([{ ...report, filePath }]));
      const transformed = readFileSync(filePath, 'utf8');
      if (executable) assert.equal(executeFile(filePath), '42\n');
      assert.equal(transformed, fixture.unchanged ? fixture.source : fixture.expected);
      assert.equal(execute(directory, transformed), fixture.stdout ?? '42\n');
      if (!fixture.unchanged) {
        const [after] = await linter.lintText(transformed, { filePath: typed ? 'input.ts' : 'input.js' });
        assert.deepEqual(after.messages, []);
      }
    });
  }
}
