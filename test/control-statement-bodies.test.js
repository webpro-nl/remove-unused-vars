import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import ts from 'typescript';

const root = path.resolve();
const following = '\nconsole.log(42);\n';
const cases = [
  { name: 'false if', source: 'if (false) var unused = 1;', bodies: 1 },
  { name: 'true if', source: 'if (true) var unused = 1;', bodies: 1 },
  { name: 'then before else', source: 'if (true) var unused = 1; else console.log(0);', bodies: 1 },
  {
    name: 'else still executes',
    source: 'if (false) var unused = 1; else console.log(7);',
    bodies: 1,
    output: '7\n42\n',
  },
  { name: 'else body', source: 'if (false) console.log(0); else var unused = 1;', bodies: 1 },
  {
    name: 'both branches and multiple intervals',
    source: 'if (true) var first = 1; else var second = 2;\nconst third = 3;',
    names: ['first', 'second', 'third'],
    bodies: 2,
  },
  {
    name: 'nested dangling else',
    source: 'if (true) if (false) var unused = 1; else console.log(7);',
    bodies: 1,
    output: '7\n42\n',
  },
  {
    name: 'finite while',
    source: 'let count = 0;\nwhile (count++ < 2) var unused = 1;\nconsole.log(count);',
    bodies: 1,
    output: '3\n42\n',
  },
  { name: 'zero iteration while', source: 'while (false) var unused = 1;', bodies: 1 },
  {
    name: 'finite for',
    source: 'for (let count = 0; count < 2; count++) var unused = 1;',
    bodies: 1,
  },
  { name: 'for of body', source: 'for (const item of [1, 2]) var unused = item;', bodies: 1 },
  { name: 'for in body', source: 'for (const item in { a: 1, b: 2 }) var unused = item;', bodies: 1 },
  {
    name: 'finite do while',
    source: 'let count = 0;\ndo var unused = 1; while (count++ < 2);\nconsole.log(count);',
    bodies: 1,
    output: '3\n42\n',
  },
  { name: 'labeled body', source: 'label: var unused = 1;', bodies: 1 },
  { name: 'nested labels', source: 'outer: inner: var unused = 1;', bodies: 1 },
  { name: 'label under if', source: 'if (false) label: var unused = 1;', bodies: 1 },
  {
    name: 'no semicolon and line comment',
    source: 'if (false) // body, comment\n  var unused = 1',
    bodies: 1,
  },
  {
    name: 'all declarators unused with comment commas',
    source: 'if (false) var first = 1 /* , */, second = 2;',
    names: ['first', 'second'],
    bodies: 1,
  },
  {
    name: 'whole object destructuring',
    source: 'if (false) var { first /* , */, second } = { first: 1, second: 2 };',
    names: ['first', 'second'],
    bodies: 1,
  },
  {
    name: 'whole array destructuring in do',
    source: 'do var [first /* , */, second] = [1, 2]; while (false);',
    names: ['first', 'second'],
    bodies: 1,
  },
  { name: 'block deletion', source: 'if (false) { var unused = 1; }', bodies: 0 },
  { name: 'module deletion', source: 'const unused = 1;', bodies: 0 },
  {
    name: 'module destructuring deletion',
    source: 'const { first, second } = { first: 1, second: 2 };',
    names: ['first', 'second'],
    bodies: 0,
  },
  {
    name: 'partial destructuring keeps its body',
    source: 'if (true) var { kept, unused } = { kept: 7, unused: 1 };\nconsole.log(kept);',
    bodies: 0,
    output: '7\n42\n',
  },
  {
    name: 'used declaration remains',
    source: 'if (true) var kept = 7;\nconsole.log(kept);',
    names: [],
    unchanged: true,
    bodies: 0,
    output: '7\n42\n',
  },
  {
    name: 'write only assignment remains',
    source: 'if (true) var unused = 1;\nunused = 2;',
    unchanged: true,
    bodies: 0,
  },
  {
    name: 'write only update remains',
    source: 'if (true) var unused = 1;\nunused++;',
    unchanged: true,
    bodies: 0,
  },
  {
    name: 'for header remains',
    source: 'for (var unused = 1; false;) console.log(0);',
    unchanged: true,
    bodies: 0,
  },
  {
    name: 'for of header remains',
    source: 'for (const unused of []) console.log(0);',
    unchanged: true,
    bodies: 0,
  },
  {
    name: 'initializer effect policy remains',
    source: 'if (true) var unused = console.log(7);',
    before: '7\n42\n',
    bodies: 1,
  },
];

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5000, ...options });
  assert.ifError(result.error);
  return result;
}

function consume(source, typed) {
  const file = ts.createSourceFile('consumer.' + (typed ? 'ts' : 'js'), source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(
    file.parseDiagnostics.map(diagnostic => diagnostic.messageText),
    [],
    'consumer must parse before transpilation',
  );
  const code = typed
    ? ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
        .outputText
    : source;
  const result = runNode(['--input-type=module', '-e', code]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

for (const typed of [false, true]) {
  const ruleId = typed ? '@typescript-eslint/no-unused-vars' : 'no-unused-vars';
  for (const fixture of cases) {
    test(`${ruleId}: ${fixture.name}`, { timeout: 15000 }, async t => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruv-control-bodies-'));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const filePath = path.join(dir, typed ? 'input.ts' : 'input.js');
      // A real type annotation exercises TS consumers without Node's strip-types feature.
      const source =
        (typed ? 'const answer: number = 42;\n' : '') + fixture.source +
        (typed ? '\nconsole.log(answer);\n' : following);
      fs.writeFileSync(filePath, source);
      assert.equal(consume(source, typed), fixture.before ?? fixture.output ?? '42\n', 'original consumer');

      const eslint = new ESLint({
        cwd: dir,
        overrideConfigFile: path.join(root, 'fixtures/eslint.config.js'),
        overrideConfig: { rules: { 'no-unused-vars': 'off', [ruleId]: 'error' } },
      });
      const results = await eslint.lintFiles([filePath]);
      const names = fixture.names ?? ['unused'];
      const messages = results.flatMap(result => result.messages);
      assert.equal(messages.length, names.length, JSON.stringify(messages));
      const diagnosed = messages.map(message => {
        assert.equal(message.ruleId, ruleId);
        assert.equal(message.messageId, 'unusedVar');
        assert.equal(message.severity, 2);
        return source.split('\n')[message.line - 1].slice(message.column - 1, message.endColumn - 1);
      });
      assert.deepEqual(diagnosed.sort(), [...names].sort());
      const report = (await eslint.loadFormatter('json')).format(results);
      const cli = runNode([path.join(root, 'index.js')], { input: report });
      assert.equal(cli.status, 0, cli.stderr);
      const transformed = fs.readFileSync(filePath, 'utf8');
      assert.equal(consume(transformed, typed), fixture.output ?? '42\n', 'transformed consumer');

      if (fixture.unchanged) assert.equal(transformed, source);
      const parsed = ts.createSourceFile(filePath, transformed, ts.ScriptTarget.Latest, true);
      let emptyBodies = 0;
      const bindings = new Set();
      const visit = node => {
        if (ts.isEmptyStatement(node)) emptyBodies++;
        if ((ts.isVariableDeclaration(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name)) {
          bindings.add(node.name.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      if (!fixture.unchanged) for (const name of names) assert.equal(bindings.has(name), false, `${name} removed`);
      assert.equal(emptyBodies, fixture.bodies, 'only removed unbraced bodies need an empty statement');
      assert.ok(ts.isExpressionStatement(parsed.statements.at(-1)), 'following output stays at module scope');
    });
  }
}
