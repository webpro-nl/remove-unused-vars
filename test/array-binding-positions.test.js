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
const cases = [
  {
    name: 'leading slot',
    source: 'const [unused, kept] = [1, 42];\nconsole.log(kept);\n',
    typedSource: 'const [unused, kept]: [number, number] = [1, 42];\nconsole.log(kept);\n',
    unused: ['unused'],
    output: '42\n',
  },
  {
    name: 'middle slot with let',
    source: 'let [first, unused, last] = [1, 2, 42];\nconsole.log(first, last);\n',
    unused: ['unused'],
    output: '1 42\n',
  },
  {
    name: 'adjacent leading slots with var',
    source: 'var [unusedA, unusedB, kept] = [1, 2, 42];\nconsole.log(kept);\n',
    unused: ['unusedA', 'unusedB'],
    output: '42\n',
  },
  {
    name: 'adjacent middle slots',
    source: 'const [first, unusedA, unusedB, last] = [1, 2, 3, 42];\nconsole.log(first, last);\n',
    unused: ['unusedA', 'unusedB'],
    output: '1 42\n',
  },
  {
    name: 'separate removed intervals',
    source: 'const [unusedA, first, unusedB, last, unusedC] = [0, 1, 2, 42, 3];\nconsole.log(first, last);\n',
    unused: ['unusedA', 'unusedB', 'unusedC'],
    output: '1 42\n',
  },
  {
    name: 'existing holes on both sides of a removed slot',
    source: 'const [, unused, , kept] = [0, 1, 2, 42];\nconsole.log(kept);\n',
    unused: ['unused'],
    output: '42\n',
  },
  {
    name: 'removed slot before a used rest',
    source: 'const [unused, ...rest] = [1, 42, 43];\nconsole.log(JSON.stringify(rest));\n',
    typedSource: 'const [unused, ...rest]: number[] = [1, 42, 43];\nconsole.log(JSON.stringify(rest));\n',
    unused: ['unused'],
    output: '[42,43]\n',
  },
  {
    name: 'adjacent slots and an existing hole before a used rest',
    source: 'const [first, unusedA, unusedB, , ...rest] = [1, 2, 3, 4, 42, 43];\nconsole.log(first, JSON.stringify(rest));\n',
    unused: ['unusedA', 'unusedB'],
    output: '1 [42,43]\n',
  },
  {
    name: 'used rest remains empty at the original boundary',
    source: 'const [unused, ...rest] = [1];\nconsole.log(JSON.stringify(rest));\n',
    unused: ['unused'],
    output: '[]\n',
  },
  {
    name: 'unused default and surviving default',
    source: 'const [unused = 7, kept = 42] = [undefined, undefined];\nconsole.log(kept);\n',
    typedSource: 'const [unused = 7, kept = 42]: (number | undefined)[] = [undefined, undefined];\nconsole.log(kept);\n',
    unused: ['unused'],
    output: '42\n',
  },
  {
    name: 'surviving default must not consume the removed value',
    source: 'const [unused = 7, kept = 42] = [1, undefined];\nconsole.log(kept);\n',
    unused: ['unused'],
    output: '42\n',
  },
  {
    name: 'default containing commas before a used rest',
    source: 'const [unused = Math.max(7, 8), ...rest] = [undefined, 42, 43];\nconsole.log(JSON.stringify(rest));\n',
    unused: ['unused'],
    output: '[42,43]\n',
  },
  {
    name: 'commas in comments between adjacent removed slots',
    source: 'const [unusedA /* first, comma */, unusedB // second, comma\n, kept] = [1, 2, 42];\nconsole.log(kept);\n',
    unused: ['unusedA', 'unusedB'],
    output: '42\n',
  },
  {
    name: 'multiple array declarations in one report',
    source: 'const [unusedA, first] = [0, 1];\nconst [unusedB, last] = [2, 42];\nconsole.log(first, last);\n',
    unused: ['unusedA', 'unusedB'],
    output: '1 42\n',
  },
  {
    name: 'partial array binding beside a used variable declaration',
    source: 'const [unused, kept] = [1, 42], sibling = 43;\nconsole.log(kept, sibling);\n',
    unused: ['unused'],
    output: '42 43\n',
  },
  {
    name: 'trailing slot remains removable',
    source: 'const [kept, unused] = [42, 1];\nconsole.log(kept);\n',
    unused: ['unused'],
    output: '42\n',
  },
  {
    name: 'adjacent trailing slots and a trailing comma remain removable',
    source: 'const [kept, unusedA, unusedB,] = [42, 1, 2];\nconsole.log(kept);\n',
    unused: ['unusedA', 'unusedB'],
    output: '42\n',
  },
  {
    name: 'unused rest remains removable',
    source: 'const [kept, ...unused] = [42, 1, 2];\nconsole.log(kept);\n',
    unused: ['unused'],
    output: '42\n',
  },
  {
    name: 'fully unused declaration is still removed',
    source: 'const [unusedA, unusedB = 2, ...unusedRest] = [1];\nconsole.log(42);\n',
    unused: ['unusedA', 'unusedB', 'unusedRest'],
    output: '42\n',
    processed: '\nconsole.log(42);\n',
  },
  {
    name: 'fully used array remains unchanged',
    source: 'const [first, , ...rest] = [1, 2, 42, 43];\nconsole.log(first, JSON.stringify(rest));\n',
    unused: [],
    output: '1 [42,43]\n',
    unchanged: true,
  },
  {
    name: 'write-only assignment keeps its surrounding function',
    source: 'function kept() {\n  let unused = 1;\n  unused = 2;\n  return 42;\n}\nconsole.log(kept());\n',
    unused: ['unused'],
    output: '42\n',
    unchanged: true,
    diagnosticLine: 3,
  },
  {
    name: 'object binding behavior is unchanged',
    source: 'const { unused, kept } = { unused: 1, kept: 42 };\nconsole.log(kept);\n',
    unused: ['unused'],
    output: '42\n',
    processed: 'const { kept } = { unused: 1, kept: 42 };\nconsole.log(kept);\n',
  },
];

function runConsumer(source, typed) {
  // Transpile typed consumers on both Node 20 and Node 24, without strip-types.
  const code = typed
    ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
        .outputText
    : source;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result.stdout;
}

for (const typed of [false, true]) {
  const ruleId = typed ? '@typescript-eslint/no-unused-vars' : 'no-unused-vars';
  for (const fixture of cases) {
    test(`${ruleId}: ${fixture.name}`, { timeout: 30_000 }, async t => {
      const directory = mkdtempSync(path.join(tmpdir(), 'remove-unused-vars-array-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const filePath = path.join(directory, typed ? 'input.ts' : 'input.js');
      const source = (typed && fixture.typedSource) || fixture.source;
      writeFileSync(filePath, source);

      const eslint = new ESLint({
        cwd: directory,
        overrideConfigFile: true,
        overrideConfig: {
          files: ['**/*.js', '**/*.ts'],
          ...(typed && {
            languageOptions: { parser: tseslint.parser },
            plugins: { '@typescript-eslint': tseslint.plugin },
          }),
          rules: { [ruleId]: 'error' },
        },
      });
      const results = await eslint.lintFiles([filePath]);
      assert.equal(results.length, 1);
      assert.equal(results[0].fatalErrorCount, 0);
      assert.equal(results[0].messages.length, fixture.unused.length);
      const diagnosed = results[0].messages.map(message => {
        assert.equal(message.ruleId, ruleId);
        assert.equal(message.messageId, 'unusedVar');
        if (fixture.diagnosticLine) assert.equal(message.line, fixture.diagnosticLine);
        return source.split('\n')[message.line - 1].slice(message.column - 1, message.endColumn - 1);
      });
      assert.deepEqual(diagnosed.sort(), [...fixture.unused].sort());
      const before = runConsumer(source, typed);
      assert.equal(before, fixture.output, 'original consumer');

      // Feed the real JSON formatter output to the CLI without editing its payload.
      const formatter = await eslint.loadFormatter('json');
      const report = await formatter.format(results);
      const result = spawnSync(process.execPath, [cli], { input: report, encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 0, result.error?.message ?? result.stderr);
      const processed = readFileSync(filePath, 'utf8');
      const after = runConsumer(processed, typed);
      t.diagnostic(`diagnostics=${JSON.stringify(diagnosed)}; before=${JSON.stringify(before)}; after=${JSON.stringify(after)}`);
      assert.equal(after, fixture.output, 'surviving bindings must keep their original values and rest boundary');
      if (fixture.unchanged) {
        assert.equal(processed, source);
      } else if (fixture.processed) {
        assert.equal(processed, fixture.processed);
      } else {
        for (const name of fixture.unused) assert.doesNotMatch(processed, new RegExp(`\\b${name}\\b`));
      }
    });
  }
}
