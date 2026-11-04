import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'index.js');
const env = {
  ...process.env,
  NODE_DISABLE_COMPILE_CACHE: '1',
  PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`,
};

function sandbox(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ruv-oxlint-format-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
  return directory;
}

function run(directory, command, args, input) {
  const result = spawnSync(command, args, { cwd: directory, env, input, encoding: 'utf8', timeout: 15_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function lint(directory, producer, files, rule = 'unused') {
  const args = {
    oxlint: ['--threads=1', '-A', 'all', '-D', rule === 'unused' ? 'no-unused-vars' : 'no-debugger', '-f', 'json'],
    eslint: [
      '--no-config-lookup',
      '--rule',
      rule === 'unused' ? 'no-unused-vars: error' : 'no-debugger: error',
      '-f',
      'json',
    ],
    biome: [
      'lint',
      '--only',
      rule === 'unused' ? 'correctness/noUnusedVariables' : 'suspicious/noDebugger',
      '--reporter',
      'json',
    ],
  };
  const result = run(directory, path.join(root, 'node_modules/.bin', producer), [...args[producer], ...files]);
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  const report = JSON.parse(result.stdout);
  return { ...result, report };
}

function consume(directory, filename = 'valid.js') {
  const result = run(directory, process.execPath, [filename]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '42\n');
}

function applyReport(directory, report) {
  // Pass the producer's bytes through unchanged, including diagnostic order.
  const result = run(directory, process.execPath, [cli], report.stdout);
  assert.equal(result.status, 0, result.stderr);
}

const preserved = `export function kept(value) {
  let pending = 0;
  pending = value;
  return value * 2;
}
console.log(kept(21));
`;
const valid = `const unused = 1;
const { first, /* punctuation, stays inside this declaration */ second } = { first: 1, second: 2 };
${preserved}`;
const broken = 'const broken = ;\n';

for (const order of [['broken.js', 'valid.js'], ['valid.js', 'broken.js'], ['valid.js']]) {
  test(`native Oxlint report: ${order.join(', ')}`, t => {
    const directory = sandbox(t);
    writeFileSync(path.join(directory, 'valid.js'), valid);
    writeFileSync(path.join(directory, 'broken.js'), broken);
    consume(directory);
    const brokenBefore = run(directory, process.execPath, ['--check', 'broken.js']);
    assert.equal(brokenBefore.status, 1);

    const report = lint(directory, 'oxlint', order);
    assert.equal(report.status, 1);
    const diagnostics = report.report.diagnostics;
    t.diagnostic(JSON.stringify({ order, diagnostics }));
    assert.equal(diagnostics[0].filename, order[0]);
    if (order.includes('broken.js')) {
      const parserError = diagnostics.find(diagnostic => diagnostic.filename === 'broken.js');
      assert.ok(parserError);
      assert.equal(parserError.code, undefined);
      assert.equal(parserError.severity, 'error');
    }
    const unused = diagnostics.filter(diagnostic => diagnostic.code === 'eslint(no-unused-vars)');
    assert.equal(unused.length, 4);
    for (const name of ['unused', 'first', 'second', 'pending']) {
      assert.ok(unused.some(diagnostic => diagnostic.message.includes(`'${name}'`)), name);
    }

    applyReport(directory, report);
    consume(directory);
    assert.equal(readFileSync(path.join(directory, 'broken.js'), 'utf8'), broken);
    const brokenAfter = run(directory, process.execPath, ['--check', 'broken.js']);
    assert.equal(brokenAfter.status, brokenBefore.status);
    assert.equal(brokenAfter.stderr, brokenBefore.stderr);
    assert.equal(readFileSync(path.join(directory, 'valid.js'), 'utf8'), `\n${preserved}`);

    const remaining = lint(directory, 'oxlint', ['valid.js']).report.diagnostics;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].code, 'eslint(no-unused-vars)');
    assert.match(remaining[0].message, /'pending'/);
  });
}

test('native Oxlint parser-only report leaves the errored file intact', t => {
  const directory = sandbox(t);
  writeFileSync(path.join(directory, 'broken.js'), broken);
  const before = run(directory, process.execPath, ['--check', 'broken.js']);
  assert.equal(before.status, 1);
  const report = lint(directory, 'oxlint', ['broken.js']);
  assert.equal(report.report.diagnostics.length, 1);
  assert.equal(report.report.diagnostics[0].code, undefined);
  applyReport(directory, report);
  assert.equal(readFileSync(path.join(directory, 'broken.js'), 'utf8'), broken);
  const after = run(directory, process.execPath, ['--check', 'broken.js']);
  assert.equal(after.status, before.status);
  assert.equal(after.stderr, before.stderr);
});

for (const producer of ['oxlint', 'biome', 'eslint']) {
  for (const scenario of ['removable', 'empty', 'irrelevant']) {
    test(`native ${producer} report: ${scenario}`, t => {
      const directory = sandbox(t);
      const source =
        scenario === 'removable'
          ? 'const unused = 1;\nconsole.log(42);\n'
          : scenario === 'irrelevant'
            ? 'debugger;\nconsole.log(42);\n'
            : 'console.log(42);\n';
      writeFileSync(path.join(directory, 'valid.js'), source);
      consume(directory);
      const report = lint(directory, producer, ['valid.js'], scenario === 'irrelevant' ? 'debugger' : 'unused');
      const diagnostics = producer === 'eslint' ? report.report[0].messages : report.report.diagnostics;
      assert.equal(diagnostics.length, scenario === 'empty' ? 0 : 1);
      if (scenario !== 'empty') {
        const rules = {
          oxlint: scenario === 'removable' ? 'eslint(no-unused-vars)' : 'eslint(no-debugger)',
          eslint: scenario === 'removable' ? 'no-unused-vars' : 'no-debugger',
          biome: scenario === 'removable' ? 'lint/correctness/noUnusedVariables' : 'lint/suspicious/noDebugger',
        };
        assert.equal(diagnostics[0].code ?? diagnostics[0].ruleId ?? diagnostics[0].category, rules[producer]);
      }
      applyReport(directory, report);
      consume(directory);
      assert.equal(
        readFileSync(path.join(directory, 'valid.js'), 'utf8'),
        scenario === 'removable' ? '\nconsole.log(42);\n' : source,
      );
      const after = lint(directory, producer, ['valid.js'], scenario === 'irrelevant' ? 'debugger' : 'unused');
      const remaining = producer === 'eslint' ? after.report[0].messages : after.report.diagnostics;
      assert.equal(remaining.length, scenario === 'irrelevant' ? 1 : 0);
    });
  }
}
