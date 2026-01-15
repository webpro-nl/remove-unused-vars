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
  { name: 'basic const', dir: '/const', input: 'input.js', output: 'output.js' },
  { name: 'basic function', dir: '/function', input: 'input.js', output: 'output.js' },
  { name: 'basic import', dir: '/import', input: 'input.js', output: 'output.js', skip: ['biome'] },
  { name: 'basic export', dir: '/export', input: 'input.js', output: 'output.js', skip: [] },
  { name: 'basic combine', dir: '/combine', input: 'input.js', output: 'output.js', skip: ['biome'] },
  { name: 'basic enum', dir: '/enum', input: 'input.ts', output: 'output.ts', skip: ['eslint'] },
  { name: 'basic try-catch', dir: '/try-catch', input: 'input.js', output: 'output.js' },
  { name: 'basic destructure', dir: '/destructure', input: 'input.js', output: 'output.js' },
  { name: 'multibyte chars', dir: '/multibyte', input: 'input.js', output: 'output.js' },
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
