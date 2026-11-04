import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'index.js');
const eslint = path.join(root, 'node_modules/eslint/bin/eslint.js');
const config = path.join(root, 'fixtures/eslint.config.js');
const env = {
  ...process.env,
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
  NODE_DISABLE_COMPILE_CACHE: '1',
};
const consumer = 'console.log(42);\n';
const cases = [
  { name: 'whole variable', before: 'const unused = 1;\n', after: '\n', names: ['unused'] },
  { name: 'whole function', before: 'function unused() {}\n', after: '\n', names: ['unused'] },
  { name: 'whole class', before: 'class Unused {}\n', after: '\n', names: ['Unused'] },
  {
    name: 'whole object binding', before: 'const { unused, other } = { unused: 1, other: 2 };\n',
    after: '\n', names: ['unused', 'other'],
  },
  { name: 'whole array binding', before: 'const [unused, other] = [1, 2];\n', after: '\n', names: ['unused', 'other'] },
  { name: 'default import', before: 'import unused from "./values.mjs";\n', after: '\n', names: ['unused'] },
  { name: 'namespace import', before: 'import * as unused from "./values.mjs";\n', after: '\n', names: ['unused'] },
  { name: 'named imports', before: 'import { unused, other } from "./values.mjs";\n', after: '\n', names: ['unused', 'other'] },
  {
    name: 'last import without final newline', before: 'import unused from "./values.mjs";',
    after: '', names: ['unused'], tail: '', stdout: '',
  },
  { name: 'interface', before: 'interface Unused { value: number }\n', after: '\n', names: ['Unused'], typed: true },
  { name: 'type alias', before: 'type Unused = number;\n', after: '\n', names: ['Unused'], typed: true },
  { name: 'enum', before: 'enum Unused { Value = 1 }\n', after: '\n', names: ['Unused'], typed: true },
  {
    name: 'partial import with comment comma',
    before: 'import { unused, /* keep, comma */ kept } from "./values.mjs";\n',
    after: 'import { /* keep, comma */ kept } from "./values.mjs";\n', names: ['unused'], tail: 'console.log(kept);\n',
  },
  {
    name: 'partial object binding',
    before: 'const { unused, /* keep, comma */ kept } = { unused: 1, kept: 42 };\n',
    after: 'const { /* keep, comma */ kept } = { unused: 1, kept: 42 };\n', names: ['unused'], tail: 'console.log(kept);\n',
  },
  {
    name: 'partial trailing array binding', before: 'const [kept, unused] = [42, 1];\n',
    after: 'const [kept,] = [42, 1];\n', names: ['unused'], tail: 'console.log(kept);\n',
  },
  {
    name: 'partial parameter', before: 'function kept(unused) { return 42; }\n',
    after: 'function kept() { return 42; }\n', names: ['unused'], tail: 'console.log(kept());\n',
  },
  {
    name: 'later unused declaration', before: 'const kept = 42;\nconst unused = 1;\n',
    after: 'const kept = 42;\n', names: ['unused'], tail: 'console.log(kept);\n',
  },
  {
    name: 'multiple removal ranges',
    before: 'const unused = 1;\nfunction other() {}\nimport { extra, more } from "./values.mjs";\n',
    after: '\n', names: ['unused', 'other', 'extra', 'more'],
  },
  {
    name: 'ordinary leading comment keeps existing removal policy',
    before: '/* ordinary, comment */\nconst unused = 1;\n', after: '\n', names: ['unused'],
  },
  { name: 'CRLF directive', before: 'const unused = 1;\n', after: '\n', names: ['unused'], newline: '\r\n' },
  {
    name: 'exact interpreter directive', before: 'const unused = 1;\n', after: '\n',
    names: ['unused'], directive: `#!${process.execPath}`,
  },
  { name: 'no shebang declaration', before: 'const unused = 1;\n', after: '\n', names: ['unused'], directive: '' },
  {
    name: 'no shebang import', before: 'import unused from "./values.mjs";\n', after: '\n',
    names: ['unused'], directive: '',
  },
  {
    name: 'write-only guard', before: 'let unused = 0;\nunused = 1;\n',
    after: 'let unused = 0;\nunused = 1;\n', names: ['unused'],
  },
  {
    name: 'write-only enclosing class guard',
    before: 'export class Kept { run() { let unused = 0; unused = 1; return 42; } }\n',
    after: 'export class Kept { run() { let unused = 0; unused = 1; return 42; } }\n',
    names: ['unused'], tail: 'console.log(new Kept().run());\n',
  },
  { name: 'used declaration stays', before: 'const kept = 42;\n', after: 'const kept = 42;\n', names: [], tail: 'console.log(kept);\n' },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', env, timeout: 15000, ...options });
  assert.ifError(result.error);
  return result;
}

for (const rule of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  for (const fixture of cases) {
    if (fixture.typed && rule === 'no-unused-vars') continue;
    test(`shebang ${rule}: ${fixture.name}`, t => {
      const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'ruv-shebang-')));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const file = path.join(directory, fixture.typed ? 'input.ts' : 'input.js');
      const newline = fixture.newline ?? '\n';
      const directive = fixture.directive ?? '#!/usr/bin/env node';
      const shebang = directive ? directive + newline : '';
      const tail = fixture.tail ?? consumer;
      const source = shebang + (fixture.before + tail).replaceAll('\n', newline);
      writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
      writeFileSync(path.join(directory, 'values.mjs'),
        'export default 1; export const unused = 1, other = 2, extra = 3, more = 4, kept = 42;\n');
      const localConfig = path.join(directory, 'eslint.config.mjs');
      writeFileSync(localConfig, `export { default } from ${JSON.stringify(pathToFileURL(config).href)};\n`);
      writeFileSync(file, source);
      chmodSync(file, 0o755);
      const originalMode = statSync(file).mode;

      function execute() {
        let executable = file;
        if (fixture.typed) {
          // Use the installed compiler on both Node 20 and 24; no native type stripping.
          executable = path.join(directory, 'compiled.mjs');
          const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          });
          writeFileSync(executable, compiled.outputText);
        }
        const result = run(process.execPath, [executable]);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, fixture.stdout ?? '42\n');
        // Windows does not support POSIX executable permissions or shebang invocation.
        // CRLF directives and TypeScript sources are checked portably via Node above.
        if (process.platform !== 'win32' && !fixture.typed && directive && newline === '\n') {
          const direct = run(file, []);
          assert.equal(direct.status, 0, direct.stderr);
          assert.equal(direct.stdout, fixture.stdout ?? '42\n');
        }
      }

      execute();
      const report = run(process.execPath, [eslint, '-c', localConfig, '--rule',
        JSON.stringify({ 'no-unused-vars': 'off', [rule]: 'error' }), '--quiet', '-f', 'json', file], { cwd: directory });
      assert.equal(report.status, fixture.names.length ? 1 : 0, report.stderr + report.stdout);
      const results = JSON.parse(report.stdout);
      assert.equal(results.length, fixture.names.length ? 1 : 0);
      assert.equal(results[0]?.fatalErrorCount ?? 0, 0);
      assert.equal(results[0]?.messages.length ?? 0, fixture.names.length);
      for (const [index, name] of fixture.names.entries()) {
        const diagnostic = results[0].messages[index];
        assert.equal(diagnostic.ruleId, rule);
        assert.match(diagnostic.message, new RegExp(`'${name}'`));
      }
      // Pass the formatter's complete JSON output unchanged, including all suggestions.
      const removed = run(process.execPath, [cli], { input: report.stdout });
      assert.equal(removed.status, 0, removed.stderr);
      const actual = readFileSync(file, 'utf8');
      assert.equal(actual.slice(0, shebang.length), shebang);
      assert.equal(actual, shebang + (fixture.after + tail).replaceAll('\n', newline));
      assert.equal(statSync(file).mode, originalMode);
      execute();
    });
  }
}
