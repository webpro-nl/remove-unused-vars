#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

let input = '';
if (process.argv[2]) {
  input = readFileSync(process.argv[2], 'utf-8');
} else {
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) chunks.push(chunk);
  input = chunks.join('');
}

const Format = {
  ESLINT: 'eslint',
  OXLINT: 'oxlint',
  BIOME: 'biome',
};

const jsonInput = JSON.parse(input);
const format = detect(jsonInput);
const unifiedResults = transform(jsonInput, format);
removeUnusedVariables(unifiedResults);

function detect(json) {
  if (Array.isArray(json) && json[0]?.code?.startsWith('eslint') && json[0]?.labels) return Format.OXLINT;
  if (json.diagnostics && Array.isArray(json.diagnostics)) return Format.BIOME;
  return Format.ESLINT;
}

function transform(json, format) {
  switch (format) {
    case Format.OXLINT:
      return transformOxlint(json);
    case Format.BIOME:
      return transformBiome(json);
    default:
      return transformEslint(json);
  }
}

function transformBiome(input) {
  const groupedByFile = input.diagnostics
    .filter(diagnostic => diagnostic.category === 'lint/correctness/noUnusedVariables')
    .reduce((output, diagnostic) => {
      const filePath = diagnostic.location.path.file;
      if (!output[filePath]) {
        output[filePath] = { filePath, positions: [], source: diagnostic.location.sourceCode };
      }
      output[filePath].positions.push(diagnostic.location.span[0]);
      return output;
    }, {});
  return Object.values(groupedByFile);
}

function transformOxlint(input) {
  const groupedByFile = input
    .filter(result => result.code === 'eslint(no-unused-vars)')
    .reduce((output, result) => {
      const filePath = result.filename;
      if (!output[filePath]) {
        output[filePath] = { filePath, positions: [], source: result.source };
      }
      output[filePath].positions.push(result.labels[0].span.offset);
      return output;
    }, {});
  return Object.values(groupedByFile);
}

function transformEslint(input) {
  const predicate = msg => msg.ruleId === 'no-unused-vars' || msg.ruleId === '@typescript-eslint/no-unused-vars';
  return input
    .filter(result => result.messages.some(predicate))
    .map(result => ({
      filePath: result.filePath,
      positions: result.messages.filter(predicate).map(msg => [msg.line - 1, msg.column]),
      source: result.source,
    }));
}

function findParentDeclaration(node) {
  while (
    node &&
    !ts.isFunctionDeclaration(node) &&
    !ts.isVariableStatement(node) &&
    !ts.isClassDeclaration(node) &&
    !ts.isInterfaceDeclaration(node) &&
    !ts.isTypeAliasDeclaration(node)
  ) {
    node = node.parent;
  }
  return node;
}

function getPos(sourceFile, pos) {
  return typeof pos === 'number' ? pos : sourceFile.getPositionOfLineAndCharacter(pos[0], pos[1]);
}

/**
 * @typedef {Object} Results
 * @property {string} filePath
 * @property {(number | [number, number])[]} positions
 * @property {string?} source
 */

/**
 * @param {Results[]} results
 */
function removeUnusedVariables(results) {
  for (const file of results) {
    if (file.positions.length === 0) continue;

    const source = file.source ?? readFileSync(file.filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(file.filePath, source, ts.ScriptTarget.Latest, true);

    const processedImports = new Set();

    const positions = file.positions
      .map(p => {
        const pos = getPos(sourceFile, p);
        const token = ts.getTokenAtPosition(sourceFile, pos);

        if (ts.isCatchClause(token.parent.parent)) {
          return {
            start: token.parent.getFullStart(),
            end: token.parent.getEnd(),
          };
        }

        if (ts.isBindingElement(token.parent)) {
          const parameter = token.parent;
          let start = parameter.getFullStart();
          let end = parameter.getEnd();
          if (parameter !== parameter.parent.elements.at(-1)) end = source.indexOf(',', end) + 1;
          return { start, end };
        }

        if (ts.isParameter(token.parent)) {
          const parameter = token.parent;
          const parent = parameter.parent;
          if (ts.isArrowFunction(parent) && parent.parameters.length === 1) {
            const hasParens =
              source.slice(parent.parameters[0].getFullStart(), parent.parameters[0].getFullStart() + 1) === '(';
            if (!hasParens) {
              return { start: parameter.getFullStart(), end: parameter.getEnd(), replacement: ' ()' };
            }
          }

          let start = parameter.getFullStart();
          let end = parameter.getEnd();
          if (parameter !== parameter.parent.parameters.at(-1)) end = source.indexOf(',', end) + 1;
          return { start, end };
        }

        if (ts.isImportClause(token.parent)) {
          const importDecl = token.parent.parent;
          const nextToken = ts.findNextToken(importDecl, sourceFile);
          const end = nextToken ? nextToken.getFullStart() : source.length;
          return { start: importDecl.getFullStart(), end };
        } else if (ts.isImportSpecifier(token.parent)) {
          const importSpecifier = token.parent;
          const importClause = importSpecifier.parent.parent;
          const importDeclaration = importClause.parent;
          const namedBindings = importClause.namedBindings;
          if (!namedBindings?.elements) return null;
          const elements = namedBindings.elements;
          const allElementsRemoved = elements.every(element =>
            file.positions.some(p => {
              const pos = getPos(sourceFile, p);
              const token = ts.getTokenAtPosition(sourceFile, pos);
              return token.parent === element;
            }),
          );
          if (allElementsRemoved) {
            if (processedImports.has(importDeclaration.pos)) return null;
            processedImports.add(importDeclaration.pos);
            const nextToken = ts.findNextToken(importDeclaration, sourceFile);
            const end = nextToken ? nextToken.getFullStart() : source.length;
            return { start: importDeclaration.getFullStart(), end };
          }
          let start = importSpecifier.getFullStart();
          let end = importSpecifier.getEnd();
          if (importSpecifier === elements[0]) {
            const nextElement = elements[1];
            end = nextElement.getFullStart();
          } else if (importSpecifier !== elements[elements.length - 1]) {
            start = source.lastIndexOf(',', start);
          }
          return { start, end };
        } else if (ts.isNamespaceImport(token.parent)) {
          const namespaceImport = token.parent;
          const importDecl = namespaceImport.parent.parent;
          const nextToken = ts.findNextToken(importDecl, sourceFile);
          const end = nextToken ? nextToken.getFullStart() : source.length;
          return { start: importDecl.getFullStart(), end };
        }

        if (ts.isImportDeclaration(token.parent)) return null;

        const node = findParentDeclaration(token);

        if (!node) return null;

        return { start: node.getFullStart(), end: node.getEnd() };
      })
      .filter(Boolean);

    if (positions.length > 0) {
      let output = source;
      for (const { start, end, replacement } of positions.sort((a, b) => b.start - a.start)) {
        output = output.slice(0, start) + (replacement ?? '') + output.slice(end);
      }

      writeFileSync(file.filePath, output);
    }
  }
}
