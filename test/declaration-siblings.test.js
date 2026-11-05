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
    name: 'statement boundary: removed import before declaration',
    source: 'console.log(42)\nimport { readFile } from "node:fs";\nconst msg="msg",other="other";\n(()=>{})();',
    flagged: ['readFile', 'msg', 'other'],
    kept: [],
    statements: 0,
  },
  {
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: removed function before directive',
    source: 'const msg="msg",other="other";\nfunction unused() {}\n"use strict";\nwith({}){}\nconsole.log(42);',
    flagged: ['msg', 'other', 'unused'],
  },
  {
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: removed class before directive',
    source: 'const msg="msg",other="other";\nclass Unused {}\n"use strict";\nwith({}){}\nconsole.log(42);',
    flagged: ['msg', 'other', 'Unused'],
  },
  {
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: surviving function remains a directive barrier',
    source: 'const msg="msg",other="other";\nfunction kept() {}\n"use strict";\nwith({}){}\nkept();\nconsole.log(42);',
    flagged: ['msg', 'other'],
  },
  {
    flagged: ['msg', 'other'],
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: parenthesized expression',
    source: 'console.log(42)\nconst msg="msg",other="other";\n(()=>{})();',
  },
  {
    flagged: ['msg', 'other'],
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: array expression',
    source: 'console.log(42)\nconst msg="msg",other="other";\n[1].forEach(()=>{});',
  },
  {
    flagged: ['msg', 'other'],
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: template expression',
    source: 'console.log(42)\nconst msg="msg",other="other";\n`value`;',
  },
  {
    flagged: ['msg', 'other'],
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: regular expression',
    source: 'console.log(42)\nconst msg="msg",other="other";\n/pattern/.test("pattern");',
  },
  {
    flagged: ['msg', 'other'],
    kept: ['kept'],
    statements: 1,
    script: true,
    name: 'statement boundary: unary expression after a used declaration',
    source: 'let kept=42\nconst msg="msg",other="other";\n+console.log("tail");\nconsole.log(kept);',
    before: 'tail\n42\n',
    after: 'tail\n42\n',
  },
  {
    flagged: ['msg', 'other'],
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: strict directive remains an ordinary expression',
    source: 'const msg="msg",other="other";\n"use strict";\nwith({}){}\nconsole.log(42);',
  },
  {
    flagged: ['msg', 'other', 'extra', 'last'],
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: adjacent removed statements',
    source: 'console.log(42)\nconst msg="msg",other="other";\nconst extra="extra",last="last";\n(()=>{})();',
  },
  {
    flagged: ['msg', 'other'],
    kept: [],
    statements: 0,
    script: true,
    name: 'statement boundary: explicit separator control',
    source: 'console.log(42);\nconst msg="msg",other="other";\n(()=>{})();',
  },
  ...[
    ['false if', 'if (false) var msg="msg";'],
    ['true if', 'if (true) var msg="msg";'],
    ['then before else', 'if (true) var msg="msg"; else console.log(0);'],
    ['else', 'if (false) console.log(0); else var msg="msg";'],
    ['nested if before else', 'if (true) if (false) var msg="msg"; else console.log(42);', '42\n42\n'],
    ['while', 'while (false) var msg="msg";'],
    ['do while', 'do var msg="msg"; while (false);'],
    ['label', 'label: var msg="msg";'],
    ['label under if', 'if (false) label: var msg="msg";'],
    ['whole destructuring', 'if (false) var { msg="msg" } = {};'],
  ].map(([name, body, stdout]) => ({
    name: `required body: ${name}`,
    source: body + '\nconsole.log(42);\n',
    flagged: ['msg'],
    kept: [],
    statements: 0,
    emptyBodies: 1,
    before: stdout,
    after: stdout,
  })),
  {
    name: 'required body: finite for',
    source: 'for (let count=0;count<2;count++) var msg="msg";\nconsole.log(42);\n',
    flagged: ['msg'],
    kept: ['count'],
    statements: 0,
    emptyBodies: 1,
  },
  {
    name: 'required body: both branches with multiple diagnostics',
    source: 'if (false) var msg="msg"; else var other="other";\nconsole.log(42);\n',
    flagged: ['msg', 'other'],
    kept: [],
    statements: 0,
    emptyBodies: 2,
  },
  {
    name: 'required body: used sibling retains the declaration',
    source: 'if (true) var msg="msg",kept=42;\nconsole.log(kept);\n',
    flagged: ['msg'],
    kept: ['kept'],
    statements: 0,
    emptyBodies: 0,
  },
  ...['', '\uFEFF'].flatMap(bom => [
    {
      name: `${bom ? 'BOM ' : ''}same-name literal in first binding`,
      source: bom + 'const msg="msg",kept=42;\nconsole.log(kept);\n',
      flagged: ['msg'],
      kept: ['kept'],
    },
    {
      name: `${bom ? 'BOM ' : ''}same-name literal in middle binding`,
      source: bom + 'const left=20,msg="msg",right=22;\nconsole.log(left+right);\n',
      flagged: ['msg'],
      kept: ['left', 'right'],
    },
    {
      name: `${bom ? 'BOM ' : ''}same-name literal in last binding`,
      source: bom + 'const kept=42,msg="msg";\nconsole.log(kept);\n',
      flagged: ['msg'],
      kept: ['kept'],
    },
    {
      name: `${bom ? 'BOM ' : ''}multiple same-name literal diagnostics`,
      source: bom + 'const msg="msg",left=20,other="other",right=22,last="last";\nconsole.log(left+right);\n',
      flagged: ['msg', 'other', 'last'],
      kept: ['left', 'right'],
    },
    {
      name: `${bom ? 'BOM ' : ''}adjacent same-name literal diagnostics`,
      source: bom + 'const kept=42,msg="msg",other="other";\nconsole.log(kept);\n',
      flagged: ['msg', 'other'],
      kept: ['kept'],
    },
  ]),
  {
    name: 'spaced same-name literal from the RV12 sibling probe',
    source: 'const kept = 42, msg = "msg";\nconsole.log(kept);\n',
    flagged: ['msg'],
    kept: ['kept'],
  },
  {
    name: 'typed same-name literal sibling',
    source: 'const kept: number = 42, msg: string = "msg";\nconsole.log(kept);\n',
    flagged: ['msg'],
    kept: ['kept'],
    typed: true,
    coreFlagged: ['msg: string'],
  },
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
    retained: '/* before, comma */',
  },
  {
    name: 'trailing removal preserves a line comment on the kept declaration',
    source: 'const kept = 42 // kept, comment\n, unused = 0;\nconsole.log(kept);\n',
    flagged: ['unused'],
    kept: ['kept'],
    retained: '// kept, comment\n',
  },
  {
    name: 'trailing removal preserves a compact block comment on the kept declaration',
    source: 'const kept=42/*kept,comment*/,unusedA=0,unusedB=1;\nconsole.log(kept);\n',
    flagged: ['unusedA', 'unusedB'],
    kept: ['kept'],
    retained: '/*kept,comment*/',
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
    source: 'const run = () => { for (let unused = 0, kept = 42; kept < 43; kept++) console.log(kept); };\nrun();\n',
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

function execute(source, script = false) {
  const javascript = script
    ? source
    : ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
  return spawnSync(process.execPath, ['--input-type=' + (script ? 'commonjs' : 'module'), '--eval', javascript], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

for (const fixture of [
  {
    name: 'consecutive functions before a directive-like string',
    source: 'function msg(){return "msg";} function other(){} "use strict"; with({}){console.log(42);}',
    flagged: ['msg', 'other'],
    expected: '; "use strict"; with({}){console.log(42);}',
    stdout: '42\n',
  },
  {
    name: 'nested functions before a directive-like string',
    source: '(()=>{function msg(){return "msg";} function other(){} "use strict"; with({}){console.log(42);}})();',
    flagged: ['msg', 'other'],
    expected: '(()=>{; "use strict"; with({}){console.log(42);}})();',
    stdout: '42\n',
  },
  { name: 'with at end of script', source: 'with ({}) var msg="msg";', stdout: '' },
  {
    name: 'with before an outer-scope read',
    source: 'globalThis.marker=42; with ({marker:7}) var msg="msg"; console.log(marker);',
    stdout: '42\n',
  },
  {
    name: 'function in if at end of script',
    source: 'console.log(42); if(false) function msg(){return "msg";}',
    expected: 'console.log(42); if(false);',
    stdout: '42\n',
  },
  {
    name: 'function in else at end of script',
    source: 'console.log(42); if(true) console.log("kept"); else function msg(){return "msg";}',
    expected: 'console.log(42); if(true) console.log("kept"); else;',
    stdout: '42\nkept\n',
  },
  {
    name: 'function in label at end of script',
    source: 'console.log(42); label: function msg(){return "msg";}',
    expected: 'console.log(42); label:;',
    stdout: '42\n',
  },
  {
    name: 'function at top level (control)',
    source: 'console.log(42); function msg(){return "msg";}',
    expected: 'console.log(42);',
    stdout: '42\n',
  },
]) {
  test(`required body: ${fixture.name}`, { timeout: 30_000 }, async t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ruv-with-body-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'input.js');
    writeFileSync(filePath, fixture.source);
    const eslint = new ESLint({
      cwd: directory,
      overrideConfigFile: true,
      overrideConfig: {
        languageOptions: { sourceType: 'script' },
        rules: { 'no-unused-vars': 'error' },
      },
    });
    const report = await eslint.lintText(fixture.source, { filePath });
    assert.equal(report[0].fatalErrorCount, 0);
    assert.deepEqual(
      report[0].messages.map(message => [message.ruleId, message.messageId, message.line, message.column]),
      (fixture.flagged ?? ['msg']).map(name => ['no-unused-vars', 'unusedVar', 1, fixture.source.indexOf(name) + 1]),
    );
    const before = spawnSync(process.execPath, ['--input-type=commonjs', '--eval', fixture.source], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(before.status, 0, before.stderr);
    assert.equal(before.stdout, fixture.stdout);
    const formatter = await eslint.loadFormatter('json');
    const result = spawnSync(process.execPath, [cli], {
      input: await formatter.format(report),
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(filePath, 'utf8');
    const after = spawnSync(process.execPath, ['--input-type=commonjs', '--eval', output], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(after.status, 0, after.stderr);
    assert.equal(after.stdout, fixture.stdout);
    if (fixture.expected !== undefined) {
      assert.equal(output, fixture.expected);
    } else {
      const parsed = ts.createSourceFile('input.js', output, ts.ScriptTarget.Latest, true);
      const statement = parsed.statements.find(ts.isWithStatement);
      assert.ok(statement && ts.isEmptyStatement(statement.statement), 'with must retain an empty body');
    }
    assert.deepEqual(inspect(output).bindings, [], 'remove the diagnosed declaration');
  });
}

function inspect(source) {
  const parsed = ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true);
  assert.equal(parsed.parseDiagnostics.length, 0, 'transformed source must parse');
  const bindings = [];
  let emptyBodies = 0;
  const collect = name => {
    if (ts.isIdentifier(name)) bindings.push(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) collect(element.name);
  };
  const visit = node => {
    if (ts.isEmptyStatement(node)) emptyBodies++;
    if (ts.isVariableDeclaration(node)) collect(node.name);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return {
    bindings,
    statements: parsed.statements.filter(ts.isVariableStatement).length,
    emptyBodies,
    followingAtTopLevel: ts.isExpressionStatement(parsed.statements.at(-1)),
  };
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
          languageOptions:
            fixture.typed || ruleId.startsWith('@')
              ? {
                  parser: tseslint.parser,
                  parserOptions: { project: false },
                  ...(fixture.script ? { sourceType: 'script' } : {}),
                }
              : fixture.script
                ? { sourceType: 'script' }
                : {},
          plugins: { '@typescript-eslint': tseslint.plugin },
          rules: { [ruleId]: 'error' },
        },
      });
      const report = await eslint.lintText(fixture.source, { filePath });
      assert.equal(report.length, 1);
      assert.equal(report[0].fatalErrorCount, 0);
      const messages = report[0].messages;
      const lines = fixture.source.replace(/^\uFEFF/, '').split('\n');
      for (const message of messages) {
        assert.equal(message.ruleId, ruleId);
        assert.equal(message.messageId, 'unusedVar');
        assert.equal(message.line, message.endLine);
      }
      assert.deepEqual(
        messages.map(message => lines[message.line - 1].slice(message.column - 1, message.endColumn - 1)),
        fixture.typed && ruleId === 'no-unused-vars' ? (fixture.coreFlagged ?? ['unused: number']) : fixture.flagged,
        'real diagnostics must flag exactly the expected identifiers',
      );
      if (fixture.diagnosticLines)
        assert.deepEqual(
          messages.map(message => message.line),
          fixture.diagnosticLines,
        );
      const before = execute(fixture.source, fixture.script);
      assert.equal(before.status, 0, before.stderr);
      assert.equal(before.stdout, fixture.before ?? '42\n');

      const formatter = await eslint.loadFormatter('json');
      const json = await formatter.format(report);
      const result = spawnSync(process.execPath, [cli], { input: json, encoding: 'utf8', timeout: 10_000 });
      assert.equal(result.status, 0, result.stderr);
      const output = readFileSync(filePath, 'utf8');
      const after = execute(output, fixture.script);
      assert.equal(after.status, 0, after.stderr);
      assert.equal(after.stdout, fixture.after ?? '42\n');
      const actual = inspect(output);
      assert.deepEqual(actual.bindings, fixture.kept, 'remove flagged bindings while retaining the declared controls');
      assert.equal(actual.statements, fixture.statements ?? 1, 'remove the statement only when all declarators go');
      if (fixture.emptyBodies !== undefined) {
        assert.equal(actual.emptyBodies, fixture.emptyBodies, 'preserve required bodies with empty statements');
        assert.ok(actual.followingAtTopLevel, 'the following control must remain at top level');
      }
      if (fixture.unchanged) assert.equal(output, fixture.source);
      if (fixture.retained) assert.ok(output.includes(fixture.retained), fixture.retained);
    });
  }
}
