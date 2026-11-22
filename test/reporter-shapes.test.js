import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './stream-results.js';

// Reader paths the linter matrix cannot reach: reporter shapes no installed linter emits any more,
// and message shapes the current rules never produce. Both are fed to the CLI as a JSON file.

const root = path.resolve();
const fixtureDir = path.join(root, 'fixtures/diagnostic-binding-location/multibyte-before-binding');
const inputFile = path.join(fixtureDir, 'input.js');
const outputFile = path.join(fixtureDir, 'output.js');

const runWithPayload = createReport => {
  const source = fs.readFileSync(inputFile, 'utf-8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-unused-vars-'));
  try {
    const filePath = path.join(dir, 'input.js');
    fs.writeFileSync(filePath, source);
    const payloadFile = path.join(dir, 'payload.json');
    fs.writeFileSync(payloadFile, JSON.stringify(createReport(filePath, source)));
    execFileSync(process.execPath, [path.join(root, 'index.js'), payloadFile], { stdio: 'inherit' });
    return fs.readFileSync(filePath, 'utf-8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('biome before 2.5: object path, inlined source and byte offsets', () => {
  const processed = runWithPayload((filePath, source) => ({
    diagnostics: [
      {
        category: 'lint/correctness/noUnusedVariables',
        location: { path: { file: filePath }, sourceCode: source, span: [100, 103] },
      },
    ],
  }));

  assert.equal(processed, fs.readFileSync(outputFile, 'utf-8'));
});

test('eslint suggestion without a fix range falls back to line and column', () => {
  const processed = runWithPayload((filePath, source) => [
    {
      filePath,
      source,
      messages: [
        {
          ruleId: 'no-unused-vars',
          line: 6,
          column: 9,
          suggestions: [{ desc: "Remove unused variable 'bar'.", data: { varName: 'bar' } }],
        },
      ],
    },
  ]);

  assert.equal(processed, fs.readFileSync(outputFile, 'utf-8'));
});
