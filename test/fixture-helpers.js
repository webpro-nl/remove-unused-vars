import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

export async function transformFixture(fixture, linterName, verify) {
  const filePath = path.resolve('fixtures', '.' + fixture.dir, fixture.input);
  const input = fs.readFileSync(filePath, 'utf8');
  const mode = fs.statSync(filePath).mode;
  try {
    const typed = linterName === 'ts-eslint';
    const rule = typed ? '@typescript-eslint/no-unused-vars' : 'no-unused-vars';
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: {
        files: ['**/*.js', '**/*.ts', '**/*.cjs'],
        languageOptions: {
          ...(typed || fixture.input.endsWith('.ts') ? { parser: tseslint.parser } : {}),
          sourceType: fixture.script ? 'script' : 'module',
        },
        plugins: { '@typescript-eslint': tseslint.plugin },
        rules: { [rule]: fixture.argsAll ? ['error', { args: 'all', caughtErrors: 'all' }] : 'error' },
      },
    });
    const report = await eslint.lintText(input, { filePath });
    assert.equal(report[0].fatalErrorCount, 0, JSON.stringify(report[0].messages));
    const result = spawnSync(process.execPath, [path.resolve('index.js')], {
      input: JSON.stringify(report), encoding: 'utf8', timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(filePath, 'utf8');
    await verify(output);
    const after = await eslint.lintText(output, { filePath });
    assert.equal(after[0].fatalErrorCount, 0, JSON.stringify(after[0].messages));
    // Fixture text alone cannot verify execution through the shebang.
    if (fixture.executable && process.platform !== 'win32') {
      fs.chmodSync(filePath, 0o755);
      const result = spawnSync(filePath, [], {
        encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '42\n');
    }
  } finally {
    fs.writeFileSync(filePath, input);
    fs.chmodSync(filePath, mode);
  }
}
