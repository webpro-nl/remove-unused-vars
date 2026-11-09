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
  { name: 'basic export', dir: '/export', input: 'input.js', output: 'output.js', skip: [] },
  { name: 'basic combine', dir: '/combine', input: 'input.js', output: 'output.js', skip: ['biome'] },
  {
    name: 'control statements: false if',
    dir: '/control-statements/case-0',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: true if',
    dir: '/control-statements/case-1',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: then before else',
    dir: '/control-statements/case-2',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: else still executes',
    dir: '/control-statements/case-3',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: else body',
    dir: '/control-statements/case-4',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: both branches and multiple intervals',
    dir: '/control-statements/case-5',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: nested dangling else',
    dir: '/control-statements/case-6',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: finite while',
    dir: '/control-statements/case-7',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: zero iteration while',
    dir: '/control-statements/case-8',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: finite for',
    dir: '/control-statements/case-9',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: for of body',
    dir: '/control-statements/case-10',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: for in body',
    dir: '/control-statements/case-11',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: finite do while',
    dir: '/control-statements/case-12',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: labeled body',
    dir: '/control-statements/case-13',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: nested labels',
    dir: '/control-statements/case-14',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: label under if',
    dir: '/control-statements/case-15',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: no semicolon and line comment',
    dir: '/control-statements/case-16',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: all declarators unused with comment commas',
    dir: '/control-statements/case-17',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: whole object destructuring',
    dir: '/control-statements/case-18',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: whole array destructuring in do',
    dir: '/control-statements/case-19',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: block deletion',
    dir: '/control-statements/case-20',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: module deletion',
    dir: '/control-statements/case-21',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: module destructuring deletion',
    dir: '/control-statements/case-22',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: partial destructuring keeps its body',
    dir: '/control-statements/case-23',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: used declaration remains',
    dir: '/control-statements/case-24',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: write only assignment remains',
    dir: '/control-statements/case-25',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: write only update remains',
    dir: '/control-statements/case-26',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: for header remains',
    dir: '/control-statements/case-27',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: for of header remains',
    dir: '/control-statements/case-28',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: initializer effect policy remains',
    dir: '/control-statements/case-29',
    input: 'input.js',
    output: 'output.js',
  },
  {
    name: 'control statements: false if (TypeScript)',
    dir: '/control-statements/case-30',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: true if (TypeScript)',
    dir: '/control-statements/case-31',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: then before else (TypeScript)',
    dir: '/control-statements/case-32',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: else still executes (TypeScript)',
    dir: '/control-statements/case-33',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: else body (TypeScript)',
    dir: '/control-statements/case-34',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: both branches and multiple intervals (TypeScript)',
    dir: '/control-statements/case-35',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: nested dangling else (TypeScript)',
    dir: '/control-statements/case-36',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: finite while (TypeScript)',
    dir: '/control-statements/case-37',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: zero iteration while (TypeScript)',
    dir: '/control-statements/case-38',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: finite for (TypeScript)',
    dir: '/control-statements/case-39',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: for of body (TypeScript)',
    dir: '/control-statements/case-40',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: for in body (TypeScript)',
    dir: '/control-statements/case-41',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: finite do while (TypeScript)',
    dir: '/control-statements/case-42',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: labeled body (TypeScript)',
    dir: '/control-statements/case-43',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: nested labels (TypeScript)',
    dir: '/control-statements/case-44',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: label under if (TypeScript)',
    dir: '/control-statements/case-45',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: no semicolon and line comment (TypeScript)',
    dir: '/control-statements/case-46',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: all declarators unused with comment commas (TypeScript)',
    dir: '/control-statements/case-47',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: whole object destructuring (TypeScript)',
    dir: '/control-statements/case-48',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: whole array destructuring in do (TypeScript)',
    dir: '/control-statements/case-49',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: block deletion (TypeScript)',
    dir: '/control-statements/case-50',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: module deletion (TypeScript)',
    dir: '/control-statements/case-51',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: module destructuring deletion (TypeScript)',
    dir: '/control-statements/case-52',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: partial destructuring keeps its body (TypeScript)',
    dir: '/control-statements/case-53',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: used declaration remains (TypeScript)',
    dir: '/control-statements/case-54',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: write only assignment remains (TypeScript)',
    dir: '/control-statements/case-55',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: write only update remains (TypeScript)',
    dir: '/control-statements/case-56',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: for header remains (TypeScript)',
    dir: '/control-statements/case-57',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: for of header remains (TypeScript)',
    dir: '/control-statements/case-58',
    input: 'input.ts',
    output: 'output.ts',
  },
  {
    name: 'control statements: initializer effect policy remains (TypeScript)',
    dir: '/control-statements/case-59',
    input: 'input.ts',
    output: 'output.ts',
  },
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
