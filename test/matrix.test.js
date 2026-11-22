import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReport } from '../rewrite.js';
import './stream-results.js';

const fixturesDir = path.resolve('fixtures');
const cli = path.resolve('index.js');

const biomeReporterNotice = 'The `json` and `json-pretty` reporters are experimental and may change in patch releases.';

const normalizeWhitespace = text => {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
};

const expectEqual = (a, b) => {
  assert.equal(normalizeWhitespace(a), normalizeWhitespace(b));
};

const require = createRequire(import.meta.url);
function bin(pkg, name = pkg) {
  const manifest = require.resolve(`${pkg}/package.json`);
  return path.resolve(path.dirname(manifest), require(manifest).bin[name]);
}

const eslint = [bin('eslint'), '-c', path.join(fixturesDir, 'eslint.config.js'), '--quiet', '-f', 'json'];
const lintCommands = {
  eslint: [...eslint, '--rule', 'no-unused-vars: error'],
  'ts-eslint': [...eslint, '--rule', 'no-unused-vars: off', '--rule', '@typescript-eslint/no-unused-vars: error'],
  biome: [
    bin('@biomejs/biome', 'biome'),
    'lint',
    '--reporter=json',
    '--max-diagnostics=none',
    '--only=correctness/noUnusedVariables',
    '--only=correctness/noUnusedImports',
    '--only=correctness/noUnusedFunctionParameters',
  ],
  oxlint: [bin('oxlint'), '-A', 'all', '-D', 'no-unused-vars', '-f', 'json'],
};

async function rewriteFixtures(linter, fixtures, useCli = false) {
  const directory = path.join(workspace, linter);
  await fs.promises.mkdir(directory, { recursive: true });
  const inputs = fixtures.map(fixture => {
    const input = path.join(fixture.dir, fixture.input);
    fs.mkdirSync(path.join(directory, fixture.dir), { recursive: true });
    fs.copyFileSync(path.join(fixturesDir, input), path.join(directory, input));
    return input;
  });
  const { stdout, stderr, status, error, signal } = spawnSync(process.execPath, [...lintCommands[linter], ...inputs], {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', linter === 'biome' ? 'pipe' : 'inherit'],
  });
  if (stderr) {
    for (const line of stderr.split(/(?<=\n)/)) {
      if (line.trimEnd() !== biomeReporterNotice) process.stderr.write(line);
    }
  }
  if (error) throw error;
  assert.ok(status === 0 || status === 1, `${linter} failed (${signal ?? status})`);
  if (useCli) {
    execFileSync(process.execPath, [cli], { cwd: directory, input: stdout, stdio: ['pipe', 'inherit', 'inherit'] });
    return;
  }

  // Biome and Oxlint report paths relative to the linter's working directory.
  const previous = process.cwd();
  try {
    process.chdir(directory);
    applyReport(JSON.parse(stdout));
  } finally {
    process.chdir(previous);
  }
}

const fixtureOptions = {
  'basics/enum': { skip: ['eslint'] },
  'basics/import': { skip: ['biome'] },
  'basics/mixed-removals': { skip: ['biome'] },
  'declaration-siblings/adjacent-unused-destructuring-declarators-with-rest': { skip: ['biome'] },
  'diagnostic-binding-location/both-property-and-rest-are-unused': { skip: ['biome'] },
  // Only Biome reports a partial import range spanning these bindings.
  'import-clauses/partial-range-with-matching-property': { only: ['biome'] },
  'import-clauses/partial-range-with-shadowing-declaration': { only: ['biome'] },
  // Oxlint reports each unused binding separately. Biome preserves later bindings in the JSX range.
  'import-clauses/partial-range-with-jsx-reference': {
    only: ['biome', 'oxlint'],
    outputs: { oxlint: 'output-oxlint.tsx' },
  },
  // Other linters report the JSDoc-only binding as unused.
  'import-clauses/partial-range-with-jsdoc-reference': { only: ['biome'] },
  // Biome also reports the invalid declaration as unused and removes it.
  'oxlint-parser-errors/invalid-file': { skip: ['biome'] },
  'statement-boundaries/unbraced-if-before-array': { cli: true },
};

function directories(parent) {
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function discoverFixtures(group) {
  const names = directories(path.join(fixturesDir, group));
  assert.ok(names.length, `Expected case directories in fixtures/${group}`);
  return names.map(name => {
    const dir = `${group}/${name}`;
    const files = fs.readdirSync(path.join(fixturesDir, dir));
    const inputs = files.filter(file => file.startsWith('input.'));
    assert.equal(inputs.length, 1, `Expected one input file in ${dir}`);
    const [input] = inputs;
    const output = input.replace('input.', 'output.');
    const options = fixtureOptions[dir];
    for (const expected of [output, ...Object.values(options?.outputs ?? {})]) {
      assert.ok(files.includes(expected), `Missing ${dir}/${expected}`);
    }
    return { name: `${group.replaceAll('-', ' ')}: ${name.replaceAll('-', ' ')}`, dir, input, output, ...options };
  });
}

const fixtureMatrix = directories(fixturesDir).flatMap(discoverFixtures);
for (const dir of Object.keys(fixtureOptions)) {
  assert.ok(fixtureMatrix.some(fixture => fixture.dir === dir), `Missing fixture for linter options: ${dir}`);
}

const workspace = fs.mkdtempSync(path.join(tmpdir(), 'remove-unused-vars-matrix-'));
after(() => fs.rmSync(workspace, { recursive: true, force: true }));

for (const linter of Object.keys(lintCommands)) {
  const fixtures = fixtureMatrix.filter(f => (!f.only || f.only.includes(linter)) && !f.skip?.includes(linter));
  const batch = fixtures.filter(f => !f.cli);
  let batchRun;
  for (const fixture of fixtures) {
    test(`${linter} ${fixture.name}`, async () => {
      if (fixture.cli) await rewriteFixtures(linter, [fixture], true);
      else await (batchRun ??= rewriteFixtures(linter, batch));
      const actual = path.join(workspace, linter, fixture.dir, fixture.input);
      const expected = path.join(fixturesDir, fixture.dir, fixture.outputs?.[linter] ?? fixture.output);
      expectEqual(fs.readFileSync(actual, 'utf8'), fs.readFileSync(expected, 'utf8'));
    });
  }
}
