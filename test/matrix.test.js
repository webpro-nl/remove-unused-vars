import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fixturesDir = path.join(path.resolve(), 'fixtures');

const normalizeWhitespace = text => {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
};

const expectEqual = (a, b) => {
  assert.equal(normalizeWhitespace(a), normalizeWhitespace(b));
};

const execLint = (inputFile, expectOutputFile, execCmd) => {
  const original = fs.readFileSync(inputFile, 'utf-8');
  try {
    const cmd = execCmd(inputFile, expectOutputFile);
    execSync(cmd, { path: path.join(fixturesDir, '../'), stdio: 'inherit' });

    const processed = fs.readFileSync(inputFile, 'utf-8');
    const expected = fs.readFileSync(expectOutputFile, 'utf-8');

    expectEqual(processed, expected);
  } catch (error) {
    throw error;
  } finally {
    fs.writeFileSync(inputFile, original);
  }
};

function runEsLint(inputFile) {
  return `./node_modules/.bin/eslint -c fixtures/eslint.config.js --rule 'no-unused-vars: error' --quiet -f json ${inputFile} | ./index.js`;
}

function runTsEslint(inputFile) {
  return `./node_modules/.bin/eslint -c fixtures/eslint.config.js --rule 'no-unused-vars: off' --rule '@typescript-eslint/no-unused-vars: error' --quiet -f json ${inputFile} | ./index.js`;
}

function runBiome(inputFile) {
  return `./node_modules/.bin/biome lint --only correctness/noUnusedVariables --only correctness/noUnusedImports --only correctness/noUnusedFunctionParameters --reporter json ${inputFile} | ./index.js`;
}

function runOxlint(inputFile) {
  return `./node_modules/.bin/oxlint -A all -D 'no-unused-vars' -f json ${inputFile} | ./index.js`;
}

const lintRunners = {
  eslint: runEsLint,
  'ts-eslint': runTsEslint,
  biome: runBiome,
  oxlint: runOxlint,
};

const fixtureMatrix = [
  {
    name: 'Biome imports: preserves a used default and side-effect import',
    dir: '/biome-imports/case-0',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: keeps the default separated from from in a compact import',
    dir: '/biome-imports/case-1',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: preserves a comment after an unused named import group',
    dir: '/biome-imports/case-2',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: preserves a newline after an unused named import group',
    dir: '/biome-imports/case-3',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: removes an unused named-only import',
    dir: '/biome-imports/case-4',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: removes an unused import type',
    dir: '/biome-imports/case-5',
    input: 'input.ts',
    output: 'output.ts',
    only: ['biome'],
  },
  {
    name: 'Biome imports: preserves a default with comments, aliases and a trailing comma in the unused group',
    dir: '/biome-imports/case-6',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: removes an unused default import',
    dir: '/biome-imports/case-7',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: removes an unused namespace import',
    dir: '/biome-imports/case-8',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: removes a wholly unused mixed import',
    dir: '/biome-imports/case-9',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: preserves a used named binding',
    dir: '/biome-imports/case-10',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: preserves an empty import and its effects',
    dir: '/biome-imports/case-11',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  {
    name: 'Biome imports: preserves a side-effect-only import',
    dir: '/biome-imports/case-12',
    input: 'input.js',
    output: 'output.js',
    only: ['biome'],
  },
  { name: 'basic const', dir: '/const', input: 'input.js', output: 'output.js' },
  { name: 'basic function', dir: '/function', input: 'input.js', output: 'output.js' },
  { name: 'basic import', dir: '/import', input: 'input.js', output: 'output.js', skip: ['biome'] },
  { name: 'basic export', dir: '/export', input: 'input.js', output: 'output.js', skip: [] },
  { name: 'basic combine', dir: '/combine', input: 'input.js', output: 'output.js', skip: ['biome'] },
  { name: 'basic enum', dir: '/enum', input: 'input.ts', output: 'output.ts', skip: ['eslint'] },
  { name: 'basic try-catch', dir: '/try-catch', input: 'input.js', output: 'output.js' },
  { name: 'basic destructure', dir: '/destructure', input: 'input.js', output: 'output.js' },
  { name: 'multibyte chars', dir: '/multibyte', input: 'input.js', output: 'output.js' },
  { name: 'Unicode before parameter', dir: '/unicode-parameter', input: 'input.js', output: 'output.js' },
  { name: 'write-only var', dir: '/write-only', input: 'input.js', output: 'output.js' },
];

for (const [linterName, runner] of Object.entries(lintRunners)) {
  for (const fixture of fixtureMatrix) {
    if (fixture.only && !fixture.only.includes(linterName)) continue;
    if (fixture.skip?.includes(linterName)) continue;
    test(`${linterName} ${fixture.name}`, () => {
      const inputFile = path.join(fixturesDir, `${fixture.dir}/${fixture.input}`);
      const expectOutputFile = path.join(fixturesDir, `${fixture.dir}/${fixture.output}`);
      execLint(inputFile, expectOutputFile, runner);
    });
  }
}
