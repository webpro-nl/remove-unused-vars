import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import tseslint from 'typescript-eslint';

const cli = fileURLToPath(new URL('../index.js', import.meta.url));

function expectConsumer(filePath) {
  const args = filePath.endsWith('.ts')
    ? [
        '--input-type=module',
        '-e',
        ts.transpileModule(readFileSync(filePath, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
      ]
    : [filePath];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '42\n');
}

for (const typed of [false, true]) {
  const ruleId = typed ? '@typescript-eslint/no-unused-vars' : 'no-unused-vars';
  const annotation = typed ? ': number' : '';
  const cases = [
    {
      name: 'used ignored variable',
      source: 'const _used = 42;\nconsole.log(_used);\n',
    },
    {
      name: 'used ignored parameter',
      source: `function answer(_used${annotation}) { return _used; }\nconsole.log(answer(42));\n`,
    },
    {
      name: 'used ignored catch binding',
      source: 'try { throw 42; } catch (_used) { console.log(_used); }\n',
    },
    {
      name: 'used ignored array binding',
      source: 'const [_used] = [42];\nconsole.log(_used);\n',
    },
    {
      name: 'used ignored variable alongside an unused variable',
      source: 'const _used = 42;\nconst unused = 0;\nconsole.log(_used);\n',
      expected: 'const _used = 42;\nconsole.log(_used);\n',
      messageIds: ['usedIgnoredVar', 'unusedVar'],
    },
    {
      name: 'used ignored parameter alongside an unused parameter',
      source: `function answer(_used${annotation}, unused${annotation}) { return _used; }\nconsole.log(answer(42));\n`,
      expected: `function answer(_used${annotation},) { return _used; }\nconsole.log(answer(42));\n`,
      messageIds: ['usedIgnoredVar', 'unusedVar'],
    },
    {
      name: 'ordinary unused variable',
      source: 'const unused = 0;\nconst kept = 42;\nconsole.log(kept);\n',
      expected: '\nconst kept = 42;\nconsole.log(kept);\n',
      messageIds: ['unusedVar'],
    },
  ];

  for (const fixture of cases) {
    test(`${ruleId}: ${fixture.name}`, async t => {
      const directory = mkdtempSync(path.join(tmpdir(), 'remove-unused-vars-used-ignored-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const filePath = path.join(directory, typed ? 'input.ts' : 'input.mjs');
      writeFileSync(filePath, fixture.source);
      expectConsumer(filePath);

      const eslint = new ESLint({
        cwd: directory,
        overrideConfigFile: true,
        overrideConfig: {
          files: ['**/*.mjs', '**/*.ts'],
          plugins: typed ? { '@typescript-eslint': tseslint.plugin } : {},
          languageOptions: typed ? { parser: tseslint.parser } : {},
          rules: {
            [ruleId]: [
              'error',
              {
                varsIgnorePattern: '^_',
                args: 'all',
                argsIgnorePattern: '^_',
                caughtErrors: 'all',
                caughtErrorsIgnorePattern: '^_',
                destructuredArrayIgnorePattern: '^_',
                reportUsedIgnorePattern: true,
              },
            ],
          },
        },
      });
      const results = await eslint.lintFiles([filePath]);
      const formatter = await eslint.loadFormatter('json');
      const payload = await formatter.format(results);
      const [report] = JSON.parse(payload);
      assert.equal(report.filePath, filePath);
      assert.equal(report.fatalErrorCount, 0);
      assert.deepEqual(
        report.messages.map(message => message.ruleId),
        report.messages.map(() => ruleId),
      );
      assert.deepEqual(
        report.messages.map(message => message.messageId),
        fixture.messageIds ?? ['usedIgnoredVar'],
      );

      const result = spawnSync(process.execPath, [cli], { input: payload, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      expectConsumer(filePath);
      assert.equal(readFileSync(filePath, 'utf8'), fixture.expected ?? fixture.source);
    });
  }
}
