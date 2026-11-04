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
    name: 'compact first const declarator',
    source: 'const unused=0,kept=42;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'compact adjacent leading let declarators',
    source: 'let unusedA=0,unusedB=1,kept=42;\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['kept'],
  },
  {
    name: 'compact first var declarator',
    source: 'var unused=0,kept=42;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'compact unused object before an identifier',
    source: 'const{value:unused}={value:0},kept=42;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'compact unused array before an identifier',
    source: 'const[unused]=[0],kept=42;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'compact surviving destructuring',
    source: 'const unused=0,{value:kept}={value:42};\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'first const declarator',
    source: 'const unused = 0, kept = 42;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'middle let declarator',
    source: 'let left = 20, unused = 0, right = 22;\nconsole.log(left + right);\n',
    flagged: ['unused'],
    kept: ['left', 'right'],
  },
  {
    name: 'last var declarator',
    source: 'var kept = 42, unused = 0;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'adjacent leading declarators',
    source: 'const unusedA = 0, unusedB = 1, kept = 42;\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['kept'],
  },
  {
    name: 'adjacent trailing declarators',
    source: 'const kept = 42, unusedA = 0, unusedB = 1;\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['kept'],
  },
  {
    name: 'adjacent middle declarators',
    source: 'let left = 20, unusedA = 0, unusedB = 1, right = 22;\nconsole.log(left + right);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['left', 'right'],
  },
  {
    name: 'disjoint removal ranges',
    source: 'const unusedA = 0, left = 20, unusedB = 1, right = 22, unusedC = 2;\nconsole.log(left + right);\n',
    flagged: ['unusedA', 'unusedB', 'unusedC'],
    kept: ['left', 'right'],
  },
  {
    name: 'commas inside comments around separators',
    source:
      'const unusedA = 0 /* discarded, comment */, /* kept, comment */ kept = 42 /* before, comma */,\n' +
      '  // trailing, comment\n  unusedB = 1;\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['kept'],
  },
  {
    name: 'multiple declaration statements',
    source: 'const unusedA = 0, left = 20;\nlet right = 22, unusedB = 1;\nconsole.log(left + right);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['left', 'right'],
    statements: 2,
  },
  {
    name: 'fully unused object before a surviving declarator',
    source: 'const { a: unusedA, b: unusedB } = { a: 1, b: 2 }, kept = 42;\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['kept'],
  },
  {
    name: 'fully unused array between surviving declarators',
    source: 'let left = 20, [unusedA, unusedB] = [1, 2], right = 22;\nconsole.log(left + right);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['left', 'right'],
  },
  {
    name: 'fully unused object after a surviving declarator',
    source: 'var kept = 42, { value: unused } = { value: 0 };\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
  },
  {
    name: 'adjacent unused destructuring declarators with rest',
    source:
      'const { unusedA, ...unusedRest } = { unusedA: 1, other: 2 }, ' +
      '[unusedB, ...unusedTail] = [1, 2], kept = 42;\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedRest', 'unusedB', 'unusedTail'],
    kept: ['kept'],
  },
  {
    name: 'mixed trailing unused declarators',
    source: 'const kept = 42, unusedA = 0, { value: unusedB } = { value: 1 };\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['kept'],
  },
  {
    name: 'surviving destructuring retains array elision and rest',
    source: 'const unused = 0, [, kept, ...tail] = [1, 40, 2];\nconsole.log(kept + tail[0]);\n',
    flagged: ['unused'],
    kept: ['kept', 'tail'],
    retained: '[, kept, ...tail] = [1, 40, 2]',
  },
  {
    name: 'whole simple declaration is unused',
    source: 'const unusedA = 0, unusedB = 1;\nconsole.log(42);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: [],
    statements: 0,
  },
  {
    name: 'whole object declaration is unused',
    source: 'const { unusedA, unusedB } = { unusedA: 1, unusedB: 2 };\nconsole.log(42);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: [],
    statements: 0,
  },
  {
    name: 'whole array declaration is unused',
    source: 'const [unusedA, unusedB] = [1, 2];\nconsole.log(42);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: [],
    statements: 0,
  },
  {
    name: 'whole mixed declaration is unused',
    source: 'let unusedA = 0, { value: unusedB } = { value: 1 }, [unusedC] = [2];\nconsole.log(42);\n',
    flagged: ['unusedA', 'unusedB', 'unusedC'],
    kept: [],
    statements: 0,
  },
  {
    name: 'all used declarators stay unchanged',
    source: 'const left = 20, right = 22;\nconsole.log(left + right);\n',
    flagged: [],
    kept: ['left', 'right'],
    unchanged: true,
  },
  {
    name: 'write-only reassignment stays unchanged',
    source: 'let writeOnly = 0, kept = 42;\nwriteOnly = 1;\nconsole.log(kept);\n',
    flagged: ['writeOnly'],
    kept: ['writeOnly', 'kept'],
    unchanged: true,
    diagnosticLines: [2],
  },
  {
    name: 'write-only sibling survives removal of another declarator',
    source: 'let unused = 0, writeOnly = 1, kept = 42;\nwriteOnly = 2;\nconsole.log(kept);\n',
    flagged: ['unused', 'writeOnly'],
    kept: ['writeOnly', 'kept'],
    retained: 'writeOnly = 2;',
    diagnosticLines: [1, 2],
  },
  {
    name: 'for-loop bindings stay unchanged',
    source: 'for (let unused = 0, kept = 42; kept < 43; kept++) console.log(kept);\n',
    flagged: ['unused'],
    kept: ['unused', 'kept'],
    unchanged: true,
    statements: 0,
  },
  {
    name: 'for-loop inside an arrow keeps its enclosing declaration',
    source:
      'const run = () => { for (let unused = 0, kept = 42; kept < 43; kept++) console.log(kept); };\nrun();\n',
    flagged: ['unused'],
    kept: ['run', 'unused', 'kept'],
    unchanged: true,
  },
  {
    name: 'for-of inside an arrow keeps its enclosing declaration',
    source: 'const run = () => { for (const unused of [0]) console.log(42); };\nrun();\n',
    flagged: ['unused'],
    kept: ['run', 'unused'],
    unchanged: true,
  },
  {
    name: 'initializer side-effect removal policy stays unchanged',
    source: 'const unused = console.log("effect"), kept = 42;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
    before: 'effect\n42\n',
  },
  {
    name: 'typed sibling declarators',
    source: 'const unused: number = 0, kept: number = 42;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
    typed: true,
  },
];

function execute(source) {
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', javascript], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function inspect(source) {
  const parsed = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(parsed.parseDiagnostics.length, 0, 'transformed source must parse');
  const bindings = [];
  const collect = name => {
    if (ts.isIdentifier(name)) bindings.push(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) collect(element.name);
  };
  const visit = node => {
    if (ts.isVariableDeclaration(node)) collect(node.name);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return { bindings, statements: parsed.statements.filter(ts.isVariableStatement).length };
}

for (const ruleId of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  for (const fixture of cases) {
    test(`${ruleId}: ${fixture.name}`, { timeout: 30_000 }, async t => {
      const directory = mkdtempSync(path.join(tmpdir(), 'ruv-declaration-siblings-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const filePath = path.join(directory, fixture.typed ? 'input.ts' : 'input.js');
      writeFileSync(filePath, fixture.source);
      const eslint = new ESLint({
        cwd: directory,
        overrideConfigFile: true,
        overrideConfig: {
          files: ['**/*.js', '**/*.ts'],
          languageOptions: { parser: tseslint.parser, parserOptions: { project: false } },
          plugins: { '@typescript-eslint': tseslint.plugin },
          rules: { [ruleId]: 'error' },
        },
      });
      const report = await eslint.lintText(fixture.source, { filePath });
      assert.equal(report.length, 1);
      assert.equal(report[0].fatalErrorCount, 0);
      const messages = report[0].messages;
      const lines = fixture.source.split('\n');
      for (const message of messages) {
        assert.equal(message.ruleId, ruleId);
        assert.equal(message.messageId, 'unusedVar');
        assert.equal(message.line, message.endLine);
      }
      assert.deepEqual(
        messages.map(message => lines[message.line - 1].slice(message.column - 1, message.endColumn - 1)),
        fixture.typed && ruleId === 'no-unused-vars' ? ['unused: number'] : fixture.flagged,
        'real diagnostics must flag exactly the expected identifiers',
      );
      if (fixture.diagnosticLines) assert.deepEqual(messages.map(message => message.line), fixture.diagnosticLines);
      const before = execute(fixture.source);
      assert.equal(before.status, 0, before.stderr);
      assert.equal(before.stdout, fixture.before ?? '42\n');

      const formatter = await eslint.loadFormatter('json');
      const json = await formatter.format(report);
      const result = spawnSync(process.execPath, [cli], { input: json, encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      const output = readFileSync(filePath, 'utf8');
      const after = execute(output);
      assert.equal(after.status, 0, after.stderr);
      assert.equal(after.stdout, '42\n');
      const actual = inspect(output);
      assert.deepEqual(actual.bindings, fixture.kept, 'remove flagged bindings while retaining the declared controls');
      assert.equal(actual.statements, fixture.statements ?? 1, 'remove the statement only when all declarators go');
      if (fixture.unchanged) assert.equal(output, fixture.source);
      if (fixture.retained) assert.ok(output.includes(fixture.retained), fixture.retained);
    });
  }
}
