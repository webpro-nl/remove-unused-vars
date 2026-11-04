import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const cli = fileURLToPath(new URL('../index.js', import.meta.url));

const cases = [
  {
    name: 'object comment before separator',
    source: 'const { a: unused /* keep, comment */, b: kept } = { a: 0, b: 42 }; console.log(kept);',
    unused: ['unused'],
    comments: ['/* keep, comment */'],
  },
  {
    name: 'object line comment before separator',
    source: 'const { a: unused // keep, comment\n, b: kept } = { a: 0, b: 42 }; console.log(kept);',
    unused: ['unused'],
    comments: ['// keep, comment\n'],
  },
  {
    name: 'object comment on the following used binding',
    source: 'const { /* leading, comment */ unused, /* following, comment */ kept } = { kept: 42 }; console.log(kept);',
    unused: ['unused'],
    comments: ['/* following, comment */'],
  },
  {
    name: 'object multiple removals around a used binding',
    source:
      'const { a: unusedA /* first, comment */, kept, b: unusedB /* last, comment */, } = { kept: 42 }; console.log(kept);',
    unused: ['unusedA', 'unusedB'],
    comments: ['/* first, comment */', '/* last, comment */'],
  },
  {
    name: 'object consecutive leading removals',
    source: 'const { unusedA, unusedB /* keep, comment */, kept, } = { kept: 42 }; console.log(kept);',
    unused: ['unusedA', 'unusedB'],
    comments: ['/* keep, comment */'],
  },
  {
    name: 'object consecutive trailing removals',
    source: 'const { kept, unusedA, unusedB, } = { kept: 42 }; console.log(kept);',
    unused: ['unusedA', 'unusedB'],
  },
  {
    name: 'object nested used binding',
    source: 'const { unused /* keep, comment */, nested: { kept }, } = { nested: { kept: 42 } }; console.log(kept);',
    unused: ['unused'],
    comments: ['/* keep, comment */'],
  },
  {
    name: 'object used rest binding',
    source: 'const { unused /* keep, comment */, ...kept } = { value: 42 }; console.log(kept.value);',
    unused: ['unused'],
    comments: ['/* keep, comment */'],
  },
  {
    name: 'object computed key and initializer commas',
    source: 'const { ["a,b"]: unused = Math.max(1, 2), kept } = { kept: 42 }; console.log(kept);',
    unused: ['unused'],
  },
  {
    name: 'all parameters removed with comment commas',
    source: 'function run(unusedA /* keep, comment */, unusedB,) { console.log(42); } run(0, 1);',
    unused: ['unusedA', 'unusedB'],
    comments: ['/* keep, comment */'],
  },
  {
    name: 'all parameters removed with line comment',
    source: 'function run(unusedA // keep, comment\n, unusedB) { console.log(42); } run(0, 1);',
    unused: ['unusedA', 'unusedB'],
    comments: ['// keep, comment\n'],
  },
  {
    name: 'parameter comment before trailing comma',
    source:
      'function run(kept, /* leading, comment */ unused /* trailing, comment */,) { console.log(kept); } run(42, 0);',
    unused: ['unused'],
    comments: ['/* trailing, comment */'],
  },
  {
    name: 'parameter initializer contains commas',
    source: 'function run(kept, unused = Math.max(1, 2),) { console.log(kept); } run(42);',
    unused: ['unused'],
  },
  {
    name: 'used later argument retains earlier unused argument',
    source: 'function run(unused /* keep, comment */, kept,) { console.log(kept); } run(0, 42);',
    unused: ['unused'],
    remaining: ['unused'],
    unchanged: true,
  },
  {
    name: 'used middle argument with both neighbors reported',
    source: 'function run(unusedA, kept, unusedB /* keep, comment */,) { console.log(kept); } run(0, 42, 1);',
    unused: ['unusedA', 'unusedB'],
    remaining: ['unusedA'],
    comments: ['/* keep, comment */'],
  },
  {
    name: 'existing conservative parameter removal policy',
    source: 'function run(kept, unusedA, unusedB,) { console.log(kept); } run(42, 0, 1);',
    unused: ['unusedA', 'unusedB'],
    remaining: ['unusedA'],
  },
  {
    name: 'used rest parameter retains earlier unused argument',
    source: 'function run(unused /* keep, comment */, ...kept) { console.log(kept[0]); } run(0, 42);',
    unused: ['unused'],
    remaining: ['unused'],
    unchanged: true,
  },
  {
    name: 'used parameters remain unchanged',
    source: 'function run(kept, other,) { console.log(kept + other); } run(40, 2);',
    unused: [],
    unchanged: true,
  },
  {
    name: 'used object bindings remain unchanged',
    source: 'const { kept, other, } = { kept: 40, other: 2 }; console.log(kept + other);',
    unused: [],
    unchanged: true,
  },
];

for (const trailing of ['', ',']) {
  cases.push(
    {
      name: `object final removal ${trailing ? 'with' : 'without'} trailing comma`,
      source: `const { kept, unused${trailing} } = { kept: 42 }; console.log(kept);`,
      unused: ['unused'],
    },
    {
      name: `parameter final removal ${trailing ? 'with' : 'without'} trailing comma`,
      source: `function run(kept, unused${trailing}) { console.log(kept); } run(42, 0);`,
      unused: ['unused'],
    },
    {
      name: `all parameters removed ${trailing ? 'with' : 'without'} trailing comma`,
      source: `function run(unusedA, unusedB, unusedC${trailing}) { console.log(42); } run(0, 1, 2);`,
      unused: ['unusedA', 'unusedB', 'unusedC'],
    },
    {
      name: `single arrow parameter ${trailing ? 'with' : 'without'} trailing comma`,
      source: `const run = (unused${trailing}) => 42; console.log(run(0));`,
      unused: ['unused'],
    },
    {
      name: `array final removal ${trailing ? 'with' : 'without'} trailing comma`,
      source: `const [kept, unused${trailing}] = [42, 0]; console.log(kept);`,
      unused: ['unused'],
      pattern: trailing ? /\[kept,,\]/ : /\[kept,\]/,
    },
    {
      name: `array existing hole ${trailing ? 'with' : 'without'} trailing comma`,
      source: `const [, kept, unused${trailing}] = [0, 42, 1]; console.log(kept);`,
      unused: ['unused'],
      pattern: trailing ? /\[, kept,,\]/ : /\[, kept,\]/,
    },
    {
      name: `entire unused object ${trailing ? 'with' : 'without'} trailing comma`,
      source: `const { unusedA, unusedB${trailing} } = {}; console.log(42);`,
      unused: ['unusedA', 'unusedB'],
    },
  );
}

function run(args, input) {
  const result = spawnSync(process.execPath, args, {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function names(report, ruleId) {
  const messages = report.flatMap(result => result.messages);
  assert.ok(
    messages.every(message => message.ruleId === ruleId),
    JSON.stringify(messages),
  );
  return messages.map(message => message.message.match(/'([^']+)'/)[1]).sort();
}

for (const ruleId of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
      plugins: { '@typescript-eslint': tseslint.plugin },
      rules: { [ruleId]: ['error', { args: 'all' }] },
    },
  });
  for (const fixture of cases) {
    test(`${ruleId}: ${fixture.name}`, { timeout: 30_000 }, async t => {
      const directory = mkdtempSync(path.join(tmpdir(), 'ruv-list-separators-'));
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      const filePath = path.join(directory, 'consumer.mjs');
      writeFileSync(filePath, fixture.source);
      assert.equal(run([filePath]), '42\n');

      const report = JSON.parse(JSON.stringify(await eslint.lintText(fixture.source, { filePath: 'consumer.mjs' })));
      assert.deepEqual(names(report, ruleId), [...fixture.unused].sort());
      report[0].filePath = filePath;
      run([cli], JSON.stringify(report));

      const transformed = readFileSync(filePath, 'utf8');
      t.diagnostic(`Transformed consumer: ${transformed}`);
      assert.equal(run([filePath]), '42\n');
      const remaining = await eslint.lintText(transformed, { filePath: 'consumer.mjs' });
      assert.deepEqual(names(remaining, ruleId), [...(fixture.remaining ?? [])].sort());
      for (const comment of fixture.comments ?? []) assert.ok(transformed.includes(comment), transformed);
      if (fixture.unchanged) assert.equal(transformed, fixture.source);
      if (fixture.pattern) assert.match(transformed, fixture.pattern);
    });
  }
}
