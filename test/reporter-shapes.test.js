import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Reader paths the linter matrix cannot reach: reporter shapes no installed linter emits any more,
// and message shapes the current rules never produce. Both are fed to the CLI as a JSON file.

const root = path.resolve();
const inputFile = path.join(root, 'fixtures/multibyte/input.js');
const outputFile = path.join(root, 'fixtures/multibyte/output.js');

const runWithPayload = payload => {
  const original = fs.readFileSync(inputFile, 'utf-8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-unused-vars-'));
  try {
    const payloadFile = path.join(dir, 'payload.json');
    fs.writeFileSync(payloadFile, JSON.stringify(payload));
    execFileSync(process.execPath, [path.join(root, 'index.js'), payloadFile], { stdio: 'inherit' });
    return fs.readFileSync(inputFile, 'utf-8');
  } finally {
    fs.writeFileSync(inputFile, original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('biome before 2.5: object path, inlined source and byte offsets', () => {
  const source = fs.readFileSync(inputFile, 'utf-8');
  const processed = runWithPayload({
    diagnostics: [
      {
        category: 'lint/correctness/noUnusedVariables',
        location: { path: { file: inputFile }, sourceCode: source, span: [100, 103] },
      },
    ],
  });

  assert.equal(processed, fs.readFileSync(outputFile, 'utf-8'));
});
