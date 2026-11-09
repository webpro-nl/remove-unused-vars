#!/usr/bin/env node
export class Kept { run() { let unused = 0; unused = 1; return 42; } }
console.log(new Kept().run());
