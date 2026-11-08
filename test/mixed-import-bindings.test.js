import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const cli = fileURLToPath(new URL('../index.js', import.meta.url));
const eslintManifest = require.resolve('eslint/package.json');
const eslint = path.resolve(path.dirname(eslintManifest), JSON.parse(fs.readFileSync(eslintManifest)).bin.eslint);
const tsManifest = require.resolve('typescript/package.json');
const tsc = path.resolve(path.dirname(tsManifest), JSON.parse(fs.readFileSync(tsManifest)).bin.tsc);
const run = (args, options = {}) => {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' },
    ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
};

const cases = [
  {
    name: 'unused named without whitespace before from',
    clause: 'kept,{unused}',
    source: 'import kept,{unused}from "./values.mjs";\nconsole.log(kept);\n',
    unused: ['unused'],
    value: 'kept',
  },
  { name: 'unused default with used named', clause: 'unused, { kept }', unused: ['unused'], value: 'kept' },
  { name: 'unused named with used default', clause: 'kept, { unused }', unused: ['unused'], value: 'kept' },
  { name: 'unused namespace with used default', clause: 'kept, * as unused', unused: ['unused'], value: 'kept' },
  { name: 'unused default with used namespace', clause: 'unused, * as kept', unused: ['unused'], value: 'kept.kept' },
  {
    name: 'two named removed with used default',
    clause: 'kept, { unused, other }',
    unused: ['unused', 'other'],
    value: 'kept',
  },
  {
    name: 'default and leading named removed',
    clause: 'unused, { other, kept }',
    unused: ['unused', 'other'],
    value: 'kept',
  },
  {
    name: 'default and trailing named removed',
    clause: 'unused, { kept, other }',
    unused: ['unused', 'other'],
    value: 'kept',
  },
  {
    name: 'adjacent leading named removed',
    clause: 'kept, { unused, other, last }',
    unused: ['unused', 'other'],
    value: 'kept + last - 42',
  },
  {
    name: 'adjacent trailing named removed',
    clause: 'kept, { first, unused, other }',
    unused: ['unused', 'other'],
    value: 'kept + first - 42',
  },
  {
    name: 'nonadjacent named removed',
    clause: 'kept, { unused, first, other, last }',
    unused: ['unused', 'other'],
    value: 'kept + first + last - 84',
  },
  {
    name: 'named only adjacent removal',
    clause: '{ unused, other, kept }',
    unused: ['unused', 'other'],
    value: 'kept',
  },
  {
    name: 'named only trailing removal',
    clause: '{ kept, unused, other, }',
    unused: ['unused', 'other'],
    value: 'kept',
  },
  {
    name: 'aliased imports',
    clause: 'unused, { first as kept, other as discarded }',
    unused: ['unused', 'discarded'],
    value: 'kept',
  },
  { name: 'string imported name', clause: 'unused, { "first" as kept }', unused: ['unused'], value: 'kept' },
  {
    name: 'comments with commas',
    clause: 'unused /* default, note */, { /* kept, note */ kept, /* removed, note */ other, }',
    unused: ['unused', 'other'],
    value: 'kept',
    comments: ['/* kept, note */'],
  },
  {
    name: 'line comments',
    clause: 'unused, // default note\n { // kept note\n kept, // next note\n other,\n }',
    unused: ['unused', 'other'],
    value: 'kept',
    comments: ['// kept note'],
  },
  {
    name: 'namespace comments',
    clause: 'kept /* keep, note */, /* unused, note */ * as unused',
    unused: ['unused'],
    value: 'kept',
    comments: ['/* keep, note */'],
  },
  { name: 'all used named', clause: 'kept, { first as alias }', unused: [], value: 'kept + alias - 42' },
  { name: 'all used namespace', clause: 'kept, * as namespace', unused: [], value: 'kept + namespace.kept - 42' },
  {
    name: 'all unused mixed named',
    clause: 'unused, { other, last }',
    unused: ['unused', 'other', 'last'],
    allUnused: true,
  },
  { name: 'all unused mixed namespace', clause: 'unused, * as other', unused: ['unused', 'other'], allUnused: true },
  { name: 'all unused named only', clause: '{ unused, other }', unused: ['unused', 'other'], allUnused: true },
  { name: 'all unused default only', clause: 'unused', unused: ['unused'], allUnused: true },
  { name: 'all unused namespace only', clause: '* as unused', unused: ['unused'], allUnused: true },
  {
    name: 'bare import',
    source: 'import "./values.mjs";\nconsole.log(globalThis.loads);\n',
    unused: [],
    output: '1\n',
  },
  {
    name: 'several statements and Unicode',
    source:
      '/* café 🎉 */\nimport unused, { kept } from "./values.mjs";\nimport first, { other } from "./values.mjs";\nconsole.log(kept + first - 42);\n',
    unused: ['unused', 'other'],
  },
];

const typeCases = [
  {
    name: 'type default removed',
    clause: 'Unused, { type Kept }',
    unused: ['Unused'],
    body: 'export type Result = Kept;',
  },
  {
    name: 'type named removed',
    clause: 'Kept, { type Unused }',
    unused: ['Unused'],
    body: 'export type Result = Kept;',
  },
  {
    name: 'type namespace removed',
    clause: 'Kept, * as Unused',
    unused: ['Unused'],
    body: 'export type Result = Kept;',
  },
  {
    name: 'type namespace kept',
    clause: 'Unused, * as Kept',
    unused: ['Unused'],
    body: 'export type Result = Kept.Kept;',
  },
  {
    name: 'inline type and alias',
    clause: 'unused, { type Kept as Alias, type Unused, kept }',
    unused: ['unused', 'Unused'],
    body: 'const result: Alias = kept;\nconsole.log(result);',
  },
  {
    name: 'type trailing comma and comments',
    clause: 'type { Kept, Unused, Other, /* trailing, note */ }',
    unused: ['Unused', 'Other'],
    body: 'export type Result = Kept;',
  },
  { name: 'all unused types', clause: 'type { Unused, Other }', unused: ['Unused', 'Other'], allUnused: true },
  {
    name: 'all types used',
    clause: 'Kept, { type Other as Alias }',
    unused: [],
    body: 'export type Result = Kept | Alias;',
  },
];

for (const producer of ['eslint', 'ts-eslint']) {
  test(`${producer}: real diagnostics preserve mixed import consumers`, async t => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ruv-mixed-imports-')));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const rule = producer === 'eslint' ? 'no-unused-vars' : '@typescript-eslint/no-unused-vars';
    const config = path.join(directory, 'eslint.config.mjs');
    fs.writeFileSync(
      config,
      `import tseslint from ${JSON.stringify(pathToFileURL(require.resolve('typescript-eslint')).href)};
export default [{ files: ['**/*.mjs', '**/*.mts'], languageOptions: { ${producer === 'ts-eslint' ? 'parser: tseslint.parser,' : ''} }, plugins: { '@typescript-eslint': tseslint.plugin }, rules: { ${JSON.stringify(rule)}: 'error' } }];\n`,
    );
    fs.writeFileSync(
      path.join(directory, 'values.mjs'),
      'globalThis.loads = (globalThis.loads ?? 0) + 1;\nexport default 42;\nexport const kept = 42, first = 42, last = 42, unused = 0, other = 0;\n',
    );
    fs.writeFileSync(
      path.join(directory, 'values.d.mts'),
      'export default class DefaultType {}\nexport type Kept = number;\nexport type Unused = number;\nexport type Other = number;\nexport const kept: number, unused: number;\n',
    );
    fs.writeFileSync(path.join(directory, 'globals.d.ts'), 'declare const console: { log(value: unknown): void };\n');
    fs.writeFileSync(
      path.join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { noEmit: true, module: 'nodenext', target: 'es2022', types: [], skipLibCheck: true },
        include: ['*.mts', 'globals.d.ts'],
      }),
    );
    const fixtures = [
      ...cases,
      ...(producer === 'ts-eslint' ? typeCases.map(item => ({ ...item, typed: true })) : []),
    ].map((item, index) => {
      const source =
        item.source ??
        `import ${item.clause} from "./values.mjs";\n${item.typed ? (item.body ?? '') + (item.body?.includes('console.log') ? '' : '\nconsole.log(42);') : item.allUnused ? 'console.log(globalThis.loads ?? 0);' : `console.log(${item.value});`}\n`;
      const file = path.join(directory, `case-${index}.${item.typed ? 'mts' : 'mjs'}`);
      fs.writeFileSync(file, source);
      return { ...item, source, file };
    });
    const lint = () => {
      const result = run(
        [eslint, '--no-config-lookup', '--config', config, '--format', 'json', ...fixtures.map(f => f.file)],
        { cwd: directory },
      );
      assert.ok(result.status === 0 || result.status === 1, result.stderr);
      return JSON.parse(result.stdout);
    };
    const reports = lint();
    const typecheck = () => {
      const result = run([tsc, '--project', path.join(directory, 'tsconfig.json')], { cwd: directory });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    if (producer === 'ts-eslint') typecheck();
    for (const fixture of fixtures) {
      await t.test(fixture.name, () => {
        const report = reports.find(report => report.filePath === fixture.file);
        assert.equal(report.fatalErrorCount, 0);
        assert.deepEqual(
          report.messages.map(message => message.ruleId),
          fixture.unused.map(() => rule),
        );
        const names = report.messages.map(message =>
          fixture.source.split('\n')[message.line - 1].slice(message.column - 1, message.endColumn - 1),
        );
        assert.deepEqual(names.sort(), [...fixture.unused].sort());
        const execute = () => {
          if (!fixture.typed) return run([fixture.file]);
          const result = ts.transpileModule(fs.readFileSync(fixture.file, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
            reportDiagnostics: true,
          });
          assert.deepEqual(result.diagnostics, []);
          const emitted = fixture.file + '.mjs';
          fs.writeFileSync(emitted, result.outputText);
          return run([emitted]);
        };
        const before = execute();
        assert.equal(before.status, 0, before.stderr);
        assert.equal(before.stdout, fixture.allUnused && !fixture.typed ? '1\n' : (fixture.output ?? '42\n'));
        const input = JSON.stringify([report]);
        const reportFile = fixture.file + '.json';
        fs.writeFileSync(reportFile, input);
        const result = run([cli, ...(fixture.typed ? [reportFile] : [])], { input });
        assert.equal(result.status, 0, result.stderr);
        const transformed = fs.readFileSync(fixture.file, 'utf8');
        const after = execute();
        const evidence = {
          producer,
          name: fixture.name,
          diagnostics: report.messages,
          source: fixture.source,
          transformed,
          before,
          after,
        };
        t.diagnostic(JSON.stringify(evidence));
        assert.equal(after.status, 0, after.stderr);
        assert.equal(after.stdout, fixture.allUnused && !fixture.typed ? '0\n' : before.stdout);
        for (const comment of fixture.comments ?? []) assert.ok(transformed.includes(comment), comment);
        if (fixture.unused.length === 0) assert.equal(transformed, fixture.source);
        if (fixture.allUnused) assert.doesNotMatch(transformed, /\bimport\b/);
        const again = run([cli], { input });
        assert.equal(again.status, 0, again.stderr);
        assert.equal(fs.readFileSync(fixture.file, 'utf8'), transformed);
      });
    }
    await t.test('transformed sources have no remaining lint diagnostics', () => {
      const reports = lint();
      const before = reports.map(report => fs.readFileSync(report.filePath, 'utf8'));
      for (const report of reports) assert.deepEqual(report.messages, [], report.filePath);
      const again = run([cli], { input: JSON.stringify(reports) });
      assert.equal(again.status, 0, again.stderr);
      for (const [index, report] of reports.entries()) {
        assert.equal(fs.readFileSync(report.filePath, 'utf8'), before[index]);
      }
    });
    if (producer === 'ts-eslint') await t.test('transformed types still resolve', typecheck);
  });
}

test('Biome mixed ranges: real current reports and derived legacy byte spans', async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ruv-biome-mixed-')));
  const identity = fs.statSync(directory);
  t.after(() => {
    assert.equal(fs.statSync(directory).ino, identity.ino);
    assert.equal(fs.statSync(directory).dev, identity.dev);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const manifest = require.resolve('@biomejs/biome/package.json');
  const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const biome = path.resolve(path.dirname(manifest), metadata.bin.biome);
  fs.writeFileSync(path.join(directory, 'biome.json'), JSON.stringify({ root: true }));
  fs.writeFileSync(
    path.join(directory, 'values.mjs'),
    'globalThis.loads = (globalThis.loads ?? 0) + 1;\nexport default 42;\nexport const kept = 42, unused = 0;\n',
  );
  const fixtures = [
    { name: 'all unused named', clause: 'unused, { kept }', allUnused: true },
    { name: 'all unused namespace', clause: 'unused, /* café 🎉 */\r\n * as namespace', allUnused: true },
    { name: 'used named', clause: 'unused, { kept }', value: 'kept' },
    { name: 'used default with named', clause: 'kept, { unused }', value: 'kept' },
    { name: 'used namespace', clause: 'unused, /* café 🎉 */ * as namespace', value: 'namespace.kept' },
    { name: 'used default with namespace', clause: 'kept, * as unused', value: 'kept' },
    {
      name: 'partial named range and Unicode alias',
      clause: 'unused, { unused as retiré, kept as gardé }',
      value: 'gardé',
      remaining: 1,
    },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const file = path.join(directory, `case-${index}.mjs`);
    const source = `/* café 🎉 */ import ${fixture.clause} from "./values.mjs";\nconsole.log(globalThis.loads ?? 0${fixture.allUnused ? '' : `, ${fixture.value}`});\n`;
    fs.writeFileSync(file, source);
    const lint = run([biome, 'lint', '--only=correctness/noUnusedImports', '--reporter=json', file], {
      cwd: directory,
    });
    assert.equal(lint.status, 0, lint.stderr);
    const report = JSON.parse(lint.stdout);
    assert.ok(report.diagnostics.length > 0);
    if (fixture.allUnused) assert.equal(report.diagnostics.length, 1);
    // Provenance: derive only the legacy transport shape from this real Biome invocation.
    // Columns count code points; span endpoints count UTF-8 bytes, not UTF-16 code units.
    const bytesAt = ({ line, column }) => {
      const lines = source.split(/(?<=\n)|(?<=\r)(?!\n)/);
      const prefix = lines.slice(0, line - 1).join('') + [...lines[line - 1]].slice(0, column - 1).join('');
      return Buffer.byteLength(prefix, 'utf8');
    };
    const legacy = {
      diagnostics: report.diagnostics.map(diagnostic => {
        const span = [bytesAt(diagnostic.location.start), bytesAt(diagnostic.location.end)];
        if (fixture.allUnused) {
          const start = Buffer.byteLength(source.slice(0, source.indexOf(fixture.clause)), 'utf8');
          assert.deepEqual(span, [start, start + Buffer.byteLength(fixture.clause, 'utf8')]);
          assert.equal(
            Buffer.from(source)
              .subarray(...span)
              .toString('utf8'),
            fixture.clause,
          );
        }
        assert.equal(Buffer.from(source).subarray(0, span[0]).toString('utf8').endsWith('\ufffd'), false);
        assert.equal(Buffer.from(source).subarray(0, span[1]).toString('utf8').endsWith('\ufffd'), false);
        return { ...diagnostic, location: { path: { file }, sourceCode: source, span } };
      }),
    };
    for (const [shape, payload] of [
      ['current', report],
      ['legacy-derived', legacy],
    ]) {
      await t.test(`${fixture.name}: ${shape}`, () => {
        fs.writeFileSync(file, source);
        const before = run([file], { cwd: directory });
        assert.equal(before.status, 0, before.stderr);
        assert.equal(before.stdout, fixture.allUnused ? '1\n' : '1 42\n');
        const fix = run([cli], { cwd: directory, input: JSON.stringify(payload) });
        assert.equal(fix.status, 0, fix.stderr);
        const transformed = fs.readFileSync(file, 'utf8');
        const after = run([file], { cwd: directory });
        t.diagnostic(
          JSON.stringify({
            producer: `Biome ${metadata.version} CLI`,
            shape,
            name: fixture.name,
            source,
            currentDiagnostics: report.diagnostics,
            legacyDiagnostics: legacy.diagnostics,
            transformed,
            before: before.stdout,
            after: after.stdout,
          }),
        );
        assert.equal(after.status, 0, after.stderr);
        assert.equal(after.stdout, fixture.allUnused ? '0\n' : '1 42\n');
        if (fixture.allUnused) assert.doesNotMatch(transformed, /\bimport\b/);
        const remaining = run([biome, 'lint', '--only=correctness/noUnusedImports', '--reporter=json', file], {
          cwd: directory,
        });
        assert.equal(remaining.status, 0, remaining.stderr);
        // Partial named ranges can still leave individual unused specifiers.
        // Their safety contract here is the real consumer above, including module effects.
        assert.equal(JSON.parse(remaining.stdout).diagnostics.length, fixture.remaining ?? 0);
      });
    }
  }
});

test('Oxlint mixed imports preserve used consumers', async t => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ruv-oxlint-mixed-')));
  const identity = fs.statSync(directory);
  t.after(() => {
    assert.equal(fs.statSync(directory).ino, identity.ino);
    assert.equal(fs.statSync(directory).dev, identity.dev);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const manifest = require.resolve('oxlint/package.json');
  const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const oxlint = path.resolve(path.dirname(manifest), metadata.bin.oxlint);
  fs.writeFileSync(
    path.join(directory, 'values.mjs'),
    'globalThis.loads = (globalThis.loads ?? 0) + 1;\nexport default 42;\nexport const kept = 42, unused = 0;\n',
  );
  const fixtures = [
    { name: 'unused default', clause: 'unused, { kept }', value: 'kept' },
    { name: 'unused namespace', clause: 'kept, * as unused', value: 'kept' },
    { name: 'unused named without whitespace before from', clause: 'kept,{unused}', gap: '', value: 'kept' },
    { name: 'all unused', clause: 'unused, { kept }', allUnused: true },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    await t.test(fixture.name, () => {
      const file = path.join(directory, `case-${index}.mjs`);
      const source = `import ${fixture.clause}${fixture.gap ?? ' '}from "./values.mjs";\nconsole.log(${fixture.allUnused ? 'globalThis.loads ?? 0' : fixture.value});\n`;
      fs.writeFileSync(file, source);
      const lint = () => run([oxlint, '-A', 'all', '-D', 'no-unused-vars', '-f', 'json', file], { cwd: directory });
      const linted = lint();
      assert.ok(linted.status === 0 || linted.status === 1, linted.stderr);
      const report = JSON.parse(linted.stdout);
      assert.ok(report.diagnostics.some(diagnostic => diagnostic.code === 'eslint(no-unused-vars)'));
      const before = run([file], { cwd: directory });
      assert.equal(before.status, 0, before.stderr);
      assert.equal(before.stdout, fixture.allUnused ? '1\n' : '42\n');
      const fixed = run([cli], { cwd: directory, input: JSON.stringify(report) });
      assert.equal(fixed.status, 0, fixed.stderr);
      const transformed = fs.readFileSync(file, 'utf8');
      const after = run([file], { cwd: directory });
      t.diagnostic(
        JSON.stringify({
          producer: `Oxlint ${metadata.version}`,
          source,
          report,
          transformed,
          before: before.stdout,
          after: after.stdout,
        }),
      );
      assert.equal(after.status, 0, after.stderr);
      assert.equal(after.stdout, fixture.allUnused ? '0\n' : before.stdout);
      const relinted = lint();
      assert.equal(relinted.status, 0, relinted.stderr);
      assert.deepEqual(JSON.parse(relinted.stdout).diagnostics, []);
    });
  }
});
