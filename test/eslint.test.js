import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fixturesDir = path.join(path.resolve(), 'fixtures');

const expectEqual = (a, b) => {
  assert.equal(a.trim(), b.trim());
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

const runEsLint = inputFile => {
  return `./node_modules/.bin/eslint -c fixtures/eslint.config.js --rule 'no-unused-vars: error' --quiet -f json ${inputFile} | ./index.js`;
};
const runTsEslint = inputFile => {
  return `./node_modules/.bin/eslint -c fixtures/eslint.config.js --rule 'no-unused-vars: off' --rule '@typescript-eslint/no-unused-vars: error' --quiet -f json ${inputFile} | ./index.js`;
};

test('basic const', () => {
  const dir = '/const';
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runEsLint);
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runTsEslint);
});

test('basic function', () => {
  const dir = '/function';
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runEsLint);
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runTsEslint);
});

test('basic import', () => {
  const dir = '/import';
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runEsLint);
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runTsEslint);
});

test('basic export', () => {
  const dir = '/export';
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runEsLint);
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runTsEslint);
});

test('basic combine', () => {
  const dir = '/combine';
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runEsLint);
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runTsEslint);
});

test('basic enum', () => {
  const dir = '/enum';
  execLint(path.join(fixturesDir, `${dir}/input.ts`), path.join(fixturesDir, `${dir}/output.ts`), runTsEslint);
});

test('basic try-catch', () => {
  const dir = '/try-catch';
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runEsLint);
  execLint(path.join(fixturesDir, `${dir}/input.js`), path.join(fixturesDir, `${dir}/output.js`), runTsEslint);
});
