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
    const cmd = execCmd(process.platform === 'win32' ? '"%FIXTURE_INPUT%"' : '"$FIXTURE_INPUT"');
    execSync(cmd, { env: { ...process.env, FIXTURE_INPUT: inputFile }, stdio: 'inherit' });

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

for (const [linterName, runner] of Object.entries(lintRunners)) {
  for (const fixture of fixtureMatrix) {
    if (fixture.only && !fixture.only.includes(linterName)) continue;
    if (fixture.skip?.includes(linterName)) continue;
    test(`${linterName} ${fixture.name}`, () => {
      const inputFile = path.join(fixturesDir, fixture.dir, fixture.input);
      const expectOutputFile = path.join(fixturesDir, fixture.dir, fixture.outputs?.[linterName] ?? fixture.output);
      execLint(inputFile, expectOutputFile, runner);
    });
  }
}
