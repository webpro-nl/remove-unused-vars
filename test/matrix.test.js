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
    name: 'import clauses: preserves a used default and side-effect import',
    dir: '/import-clauses/case-0',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: keeps the default separated from from in a compact import',
    dir: '/import-clauses/case-1',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: preserves a comment after an unused named import group',
    dir: '/import-clauses/case-2',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: preserves a newline after an unused named import group',
    dir: '/import-clauses/case-3',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: removes an unused named-only import',
    dir: '/import-clauses/case-4',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: removes an unused import type',
    dir: '/import-clauses/case-5',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'import clauses: preserves a default with comments, aliases and a trailing comma in the unused group',
    dir: '/import-clauses/case-6',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: removes an unused default import',
    dir: '/import-clauses/case-7',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: removes an unused namespace import',
    dir: '/import-clauses/case-8',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: removes a wholly unused mixed import',
    dir: '/import-clauses/case-9',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: preserves a used named binding',
    dir: '/import-clauses/case-10',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: preserves an empty import and its effects',
    dir: '/import-clauses/case-11',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: preserves a side-effect-only import',
    dir: '/import-clauses/case-12',
    input: 'input.js',
    output: 'output.js',
  },
  // Biome reports several unused specifiers as one range that can include used ones. Only the binding at its
  // start is removed, so the cases that skip Biome would keep other unused specifiers there.
  {
    name: 'import clauses: unused named without whitespace before from',
    dir: '/import-clauses/case-13',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: unused default with used named',
    dir: '/import-clauses/case-14',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: unused named with used default',
    dir: '/import-clauses/case-15',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: unused namespace with used default',
    dir: '/import-clauses/case-16',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: unused default with used namespace',
    dir: '/import-clauses/case-17',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: two named removed with used default',
    dir: '/import-clauses/case-18',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: default and leading named removed',
    dir: '/import-clauses/case-19',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: default and trailing named removed',
    dir: '/import-clauses/case-20',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: adjacent leading named removed',
    dir: '/import-clauses/case-21',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: adjacent trailing named removed',
    dir: '/import-clauses/case-22',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: nonadjacent named removed',
    dir: '/import-clauses/case-23',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: named only adjacent removal',
    dir: '/import-clauses/case-24',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: named only trailing removal',
    dir: '/import-clauses/case-25',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: aliased imports',
    dir: '/import-clauses/case-26',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: string imported name',
    dir: '/import-clauses/case-27',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: comments with commas',
    dir: '/import-clauses/case-28',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: line comments',
    dir: '/import-clauses/case-29',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  {
    name: 'import clauses: namespace comments',
    dir: '/import-clauses/case-30',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: all used named',
    dir: '/import-clauses/case-31',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: all used namespace',
    dir: '/import-clauses/case-32',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: all unused mixed named',
    dir: '/import-clauses/case-33',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: all unused mixed namespace',
    dir: '/import-clauses/case-34',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: all unused named only',
    dir: '/import-clauses/case-35',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: all unused default only',
    dir: '/import-clauses/case-36',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: all unused namespace only',
    dir: '/import-clauses/case-37',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: several statements and Unicode',
    dir: '/import-clauses/case-38',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: type default removed',
    dir: '/import-clauses/case-39',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'import clauses: type named removed',
    dir: '/import-clauses/case-40',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'import clauses: type namespace removed',
    dir: '/import-clauses/case-41',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'import clauses: type namespace kept',
    dir: '/import-clauses/case-42',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'import clauses: inline type and alias',
    dir: '/import-clauses/case-43',
    input: 'input.ts',
    output: 'output.ts',
    skip: ['biome'],
  },
  {
    name: 'import clauses: type trailing comma and comments',
    dir: '/import-clauses/case-44',
    input: 'input.ts',
    output: 'output.ts',
    skip: ['biome'],
  },
  {
    name: 'import clauses: all unused types',
    dir: '/import-clauses/case-45',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'import clauses: all types used',
    dir: '/import-clauses/case-46',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'import clauses: Unicode comment, all unused named',
    dir: '/import-clauses/case-47',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: Unicode comment, all unused namespace across lines',
    dir: '/import-clauses/case-48',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: Unicode comment, used named',
    dir: '/import-clauses/case-49',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: Unicode comment, used default with named',
    dir: '/import-clauses/case-50',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: Unicode comment, used namespace',
    dir: '/import-clauses/case-51',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: Unicode comment, used default with namespace',
    dir: '/import-clauses/case-52',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'import clauses: Unicode comment, partial named range and Unicode alias',
    dir: '/import-clauses/case-53',
    input: 'input.js',
    output: 'output.js',
    skip: ['biome'],
  },
  { name: 'basic const', dir: '/const', input: 'input.js', output: 'output.js' },
  { name: 'basic function', dir: '/function', input: 'input.js', output: 'output.js' },
  { name: 'basic import', dir: '/import', input: 'input.js', output: 'output.js', skip: ['biome'] },
  {
    name: 'arrow parameters: bare call',
    dir: '/arrow-parameters/case-0',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: bare standalone',
    dir: '/arrow-parameters/case-1',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: bare wrapper',
    dir: '/arrow-parameters/case-2',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: nested wrappers',
    dir: '/arrow-parameters/case-3',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: parenthesized call',
    dir: '/arrow-parameters/case-4',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: parenthesized wrapper',
    dir: '/arrow-parameters/case-5',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: async bare',
    dir: '/arrow-parameters/case-6',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: async parenthesized',
    dir: '/arrow-parameters/case-7',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: bare block comments with commas and parentheses',
    dir: '/arrow-parameters/case-8',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: parenthesized block comments with commas',
    dir: '/arrow-parameters/case-9',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: bare line comment',
    dir: '/arrow-parameters/case-10',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: async comment',
    dir: '/arrow-parameters/case-11',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: multiple independent intervals',
    dir: '/arrow-parameters/case-12',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: whole unused arrow declaration',
    dir: '/arrow-parameters/case-13',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: used sole parameter',
    dir: '/arrow-parameters/case-14',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'arrow parameters: typed parenthesized arrow',
    dir: '/arrow-parameters/case-15',
    input: 'input.ts',
    output: 'output.ts',
  },
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
