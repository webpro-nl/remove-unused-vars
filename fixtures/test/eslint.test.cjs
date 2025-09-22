const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const expectEqual = (a, b) => {
  expect(a.trim()).toBe(b.trim());
};

const execLint = (inputFile, expectOutputFile, execCmd) => {
  const original = fs.readFileSync(inputFile, 'utf-8');
  try {
    const cmd = execCmd(inputFile, expectOutputFile);
    execSync(cmd, { path: path.join(__dirname, '../../'), stdio: 'inherit' });

    const processed = fs.readFileSync(inputFile, 'utf-8');
    const expected = fs.readFileSync(expectOutputFile, 'utf-8');

    expectEqual(processed, expected);
  } catch (error) {
    throw error;
  } finally {
    fs.writeFileSync(inputFile, original);
  }
};

const runEsLint = (inputFile) => {
  return `eslint -c fixtures/eslint.config.js --rule 'no-unused-vars: error' --quiet -f json ${inputFile} | ./index.js`;
};
const runTsEslint = (inputFile) => {
  return `eslint -c fixtures/eslint.config.js --rule 'no-unused-vars: off' --rule '@typescript-eslint/no-unused-vars: error' --quiet -f json ${inputFile} | ./index.js`;
};

test('basic const', () => {
  const dir = '/const';
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runEsLint);
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runTsEslint);
});


test('basic function', () => {
  const dir = '/function';
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runEsLint);
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runTsEslint);
});


test('basic import', () => {
  const dir = '/import';
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runEsLint);
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runTsEslint);
});

test('basic export', () => {
  const dir = '/export';
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runEsLint);
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runTsEslint);
});

test('basic combine', () => {
  const dir = '/combine';
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runEsLint);
  execLint(path.join(__dirname, `${dir}/input.js`), path.join(__dirname, `${dir}/output.js`), runTsEslint);
});