#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { applyReport } from './rewrite.js';

let input = '';
if (process.argv[2]) {
  input = readFileSync(process.argv[2], 'utf-8');
} else {
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) chunks.push(chunk);
  input = chunks.join('');
}

applyReport(JSON.parse(input));
