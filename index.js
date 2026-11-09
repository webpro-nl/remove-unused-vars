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

function createByteToCharConverter(source) {
  const encoder = new TextEncoder();
  const byteToChar = new Map();
  let byteOffset = 0;
  let charOffset = 0;
  for (const char of source) {
    byteToChar.set(byteOffset, charOffset);
    byteOffset += encoder.encode(char).length;
    charOffset += char.length;
  }
  byteToChar.set(byteOffset, source.length);
  return byteOffset => byteToChar.get(byteOffset) ?? source.length;
}

function createLineColumnToCharConverter(source) {
  // Biome counts Unicode code points and treats only CR and LF as line breaks.
  const lineStarts = [0];
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    lineStarts.push(match.index + match[0].length);
  }
  return ({ line, column }) => {
    let offset = lineStarts[line - 1];
    for (let i = 1; i < column; i++) {
      offset += source.codePointAt(offset) > 0xffff ? 2 : 1;
    }
    return offset;
  };
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
  if (json.diagnostics && Array.isArray(json.diagnostics)) {
    return json.diagnostics[0]?.code?.startsWith('eslint') ? Format.OXLINT : Format.BIOME;
  }
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
    .filter(
      diagnostic =>
        diagnostic.category === 'lint/correctness/noUnusedVariables' ||
        diagnostic.category === 'lint/correctness/noUnusedImports' ||
        diagnostic.category === 'lint/correctness/noUnusedFunctionParameters',
    )
    .reduce((output, diagnostic) => {
      // Biome <2.5 reported `path: {file}`, byte offsets in `span`, and the file inlined as `sourceCode`;
      // 2.5+ reports a string `path` and 1-based line/column in `start`. Both shapes stay supported.
      const location = diagnostic.location;
      const filePath = typeof location.path === 'string' ? location.path : location.path.file;
      if (!output[filePath]) {
        const source = location.sourceCode ?? readFileSync(filePath, 'utf-8');
        output[filePath] = {
          filePath,
          positions: [],
          importRanges: [],
          source,
          toChar: location.start ? createLineColumnToCharConverter(source) : createByteToCharConverter(source),
        };
      }
      output[filePath].positions.push(output[filePath].toChar(location.start ?? location.span[0]));
      const end = location.end ?? location.span?.[1];
      if (diagnostic.category === 'lint/correctness/noUnusedImports' && end !== undefined) {
        output[filePath].importRanges.push({
          start: output[filePath].positions.at(-1),
          end: output[filePath].toChar(end),
        });
      }
      return output;
    }, {});
  return Object.values(groupedByFile).map(({ filePath, positions, importRanges, source }) => ({
    filePath,
    positions,
    importRanges,
    source,
  }));
}

function transformOxlint(input) {
  const groupedByFile = input.diagnostics
    .filter(result => result.code === 'eslint(no-unused-vars)' && result.labels?.[0]?.span)
    .reduce((output, result) => {
      const filePath = result.filename;
      if (!output[filePath]) {
        const source = readFileSync(filePath, 'utf-8');
        output[filePath] = { filePath, positions: [], source, byteToChar: createByteToCharConverter(source) };
      }
      const span = result.labels[0].span;
      output[filePath].positions.push(output[filePath].byteToChar(span.offset));
      return output;
    }, {});
  return Object.values(groupedByFile).map(({ filePath, positions, source }) => ({ filePath, positions, source }));
}

function transformEslint(input) {
  const predicate = msg => msg.ruleId === 'no-unused-vars' || msg.ruleId === '@typescript-eslint/no-unused-vars';
  return input
    .filter(result => result.messages.some(predicate))
    .map(result => {
      const source = result.source ?? readFileSync(result.filePath, 'utf-8');
      return {
        filePath: result.filePath,
        positions: result.messages.filter(predicate).map(msg => {
          if (msg.ruleId === 'no-unused-vars') {
            // catch clause no suggestions
            if (!msg.suggestions) return [msg.line - 1, msg.column - 1];
            const range = msg.suggestions[0]?.fix?.range;
            const varName = msg.suggestions[0]?.data?.varName;
            if (range && varName) {
              const offset = source.slice(range[0], range[1]).lastIndexOf(varName);
              return range[0] + offset;
            }
            if (range) return range[0] + (range[1] - range[0] > 1 ? 1 : 0); // i can't
          }
          // It's probably more precise to use the range from the suggestion, but the rule does not provide it yet
          // When https://github.com/typescript-eslint/typescript-eslint/issues/10497 is fixed,
          // then we can use the range from the suggestion.
          return [msg.line - 1, msg.column - 1];
        }),
        source,
      };
    });
}

function findParentDeclaration(node) {
  while (
    node &&
    !ts.isFunctionDeclaration(node) &&
    !ts.isVariableStatement(node) &&
    !ts.isClassDeclaration(node) &&
    !ts.isInterfaceDeclaration(node) &&
    !ts.isTypeAliasDeclaration(node) &&
    !ts.isEnumDeclaration(node)
  ) {
    node = node.parent;
  }
  return node;
}

function isWriteTarget(id) {
  const parent = id.parent;
  if (ts.isBinaryExpression(parent) && parent.left === id && ts.isAssignmentOperator(parent.operatorToken.kind)) {
    return true;
  }
  if ((ts.isPostfixUnaryExpression(parent) || ts.isPrefixUnaryExpression(parent)) && parent.operand === id) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return false;
}

function isDeclarationName(token, node) {
  if (!ts.isIdentifier(token)) return false;
  return ts.isVariableStatement(node)
    ? ts.isVariableDeclaration(token.parent) && token.parent.name === token
    : node.name === token;
}

function hasMatchingIdentifier(name, sourceFile, predicate) {
  let found = false;
  const visit = node => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name && predicate(node)) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function getPos(sourceFile, pos) {
  return typeof pos === 'number' ? pos : sourceFile.getPositionOfLineAndCharacter(pos[0], pos[1]);
}

function areAllParametersFlagged(parameters, positions, sourceFile) {
  return parameters.every(paramNode => {
    return positions.some(p => {
      const position = getPos(sourceFile, p);
      const tokenAtPosition = ts.getTokenAtPosition(sourceFile, position);
      return tokenAtPosition.parent === paramNode;
    });
  });
}

/**
 * @typedef {Object} Results
 * @property {string} filePath
 * @property {(number | [number, number])[]} positions
 * @property {{start: number, end: number}[]} [importRanges]
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
    const processedBindings = new Set();

    const positions = file.positions
      .map(p => {
        const pos = getPos(sourceFile, p);
        const token = ts.getTokenAtPosition(sourceFile, pos);

        if (token.parent) {
          if (ts.isCatchClause(token.parent.parent)) {
            const preToken = ts.findPrecedingToken(token.getFullStart(), sourceFile);
            const nextToken = ts.findNextToken(token, sourceFile);
            if (preToken && nextToken && preToken.getText() === '(' && nextToken.getText() === ')') {
              return {
                start: preToken.getFullStart(),
                end: nextToken.getEnd(),
              };
            }
            return null;
          }

          if (ts.isBindingElement(token.parent)) {
            const bindingElement = token.parent;
            const bindingPattern = bindingElement.parent;

            if (ts.isObjectBindingPattern(bindingPattern) || ts.isArrayBindingPattern(bindingPattern)) {
              const variableDeclaration = bindingPattern.parent;

              if (ts.isVariableDeclaration(variableDeclaration)) {
                const elements = bindingPattern.elements;
                const allElementsRemoved = elements.every(element =>
                  file.positions.some(p => {
                    const pos = getPos(sourceFile, p);
                    const token = ts.getTokenAtPosition(sourceFile, pos);
                    return token.parent === element;
                  }),
                );

                if (allElementsRemoved) {
                  const variableDeclarationList = variableDeclaration.parent;
                  const variableStatement = variableDeclarationList.parent;
                  if (ts.isVariableStatement(variableStatement)) {
                    if (processedBindings.has(variableStatement.pos)) return null;
                    processedBindings.add(variableStatement.pos);
                    return { start: variableStatement.getFullStart(), end: variableStatement.getEnd() };
                  }
                }
              }
            }

            const start = bindingElement.getFullStart();
            let end = bindingElement.getEnd();
            if (bindingElement !== bindingPattern.elements.at(-1)) end = source.indexOf(',', end) + 1;
            return { start, end };
          }

          if (ts.isParameter(token.parent)) {
            const parameter = token.parent;
            const parent = parameter.parent;
            if (ts.isArrowFunction(parent) && parent.parameters.length === 1) {
              const hasParens =
                source.slice(parent.parameters[0].getFullStart() - 1, parent.parameters[0].getFullStart()) === '(';
              if (!hasParens) {
                return { start: parameter.getFullStart(), end: parameter.getEnd(), replacement: ' ()' };
              }
            }

            const parameters = parameter.parent.parameters;
            const isLastParameter = parameter === parameters.at(-1);
            if (!isLastParameter) {
              // safety net, biome reports unused leading args before used args
              if (!areAllParametersFlagged(parameters, file.positions, sourceFile)) return null;
            }

            const start = parameter.getFullStart();
            let end = parameter.getEnd();
            if (!isLastParameter) end = source.indexOf(',', end) + 1;
            return { start, end };
          }

          if (
            ts.isImportClause(token.parent) ||
            ts.isImportSpecifier(token.parent) ||
            ts.isNamespaceImport(token.parent) ||
            (ts.isNamedImports(token.parent) && token.kind === ts.SyntaxKind.OpenBraceToken)
          ) {
            const importClause = ts.isImportClause(token.parent)
              ? token.parent
              : ts.isImportSpecifier(token.parent)
                ? token.parent.parent.parent
                : token.parent.parent;
            const importDeclaration = importClause.parent;
            if (processedImports.has(importDeclaration.pos)) return null;
            processedImports.add(importDeclaration.pos);

            const namedBindings = importClause.namedBindings;
            const elements = namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements : [];
            const bindings = [
              ...(importClause.name ? [importClause.name] : []),
              ...(namedBindings && ts.isNamespaceImport(namedBindings) ? [namedBindings] : elements),
            ];
            const flagged = new Set(
              bindings.filter(binding =>
                file.positions.some(p => {
                  const token = ts.getTokenAtPosition(sourceFile, getPos(sourceFile, p));
                  return (
                    token === binding ||
                    token.parent === binding ||
                    (ts.isNamedImports(token.parent) &&
                      token.kind === ts.SyntaxKind.OpenBraceToken &&
                      binding.parent === token.parent)
                  );
                }),
              ),
            );
            // Biome ranges can include used bindings; even unrelated occurrences keep a binding.
            for (const binding of bindings) {
              if (flagged.has(binding)) continue;
              const inRange = file.importRanges?.some(
                range => range.start <= binding.getStart(sourceFile) && range.end >= binding.getEnd(),
              );
              const name = ts.isIdentifier(binding) ? binding.text : binding.name.text;
              if (
                inRange &&
                !hasMatchingIdentifier(name, sourceFile, node => node !== binding && node.parent !== binding)
              ) {
                flagged.add(binding);
              }
            }
            if (bindings.every(binding => flagged.has(binding))) {
              const nextToken = ts.findNextToken(importDeclaration, sourceFile);
              const end = nextToken ? nextToken.getFullStart() : source.length;
              return { start: importDeclaration.getFullStart(), end };
            }

            // Plan the whole clause once: several diagnostics may share its separators.
            const removed = [];
            if (flagged.has(importClause.name)) removed.push(importClause.name);
            const removeNamedBindings =
              namedBindings &&
              (ts.isNamespaceImport(namedBindings)
                ? flagged.has(namedBindings)
                : elements.length > 0 && elements.every(element => flagged.has(element)));
            if (removeNamedBindings) removed.push(namedBindings);
            if (importClause.name && namedBindings && (flagged.has(importClause.name) || removeNamedBindings)) {
              removed.push(ts.findNextToken(importClause.name, sourceFile));
            }
            if (elements.length > 0 && !removeNamedBindings) {
              const kept = elements.filter(element => !flagged.has(element));
              const commas = namedBindings
                .getChildren(sourceFile)
                .flatMap(child => child.getChildren(sourceFile))
                .filter(child => child.kind === ts.SyntaxKind.CommaToken);
              for (let i = 0; i < elements.length; i++) {
                if (flagged.has(elements[i])) removed.push(elements[i]);
                if (
                  commas[i] &&
                  (flagged.has(elements[i]) || (elements[i] === kept.at(-1) && !elements.hasTrailingComma))
                ) {
                  removed.push(commas[i]);
                }
              }
            }
            const start = importClause.getStart(sourceFile);
            const end = importClause.getEnd();
            let replacement = source.slice(start, end);
            for (const node of removed.sort((a, b) => b.getEnd() - a.getEnd())) {
              replacement =
                replacement.slice(0, node.getStart(sourceFile) - start) + replacement.slice(node.getEnd() - start);
            }
            if (removeNamedBindings && importClause.name && source.startsWith('from', end)) replacement += ' ';
            return { start, end, replacement };
          }

          if (ts.isImportDeclaration(token.parent)) return null;
        }

        const node = findParentDeclaration(token);

        if (!node) return null;

        if (!isDeclarationName(token, node) || hasMatchingIdentifier(token.text, sourceFile, isWriteTarget)) {
          return null;
        }

        return { start: node.getFullStart(), end: node.getEnd() };
      })
      .filter(Boolean);

    if (positions.length > 0) {
      let output = source;
      positions.sort((a, b) => {
        return b.end - a.end;
      });

      let lastStart = Infinity;
      for (const { start, end, replacement } of positions) {
        // skip covered positions
        if (end <= lastStart) {
          output = output.slice(0, start) + (replacement ?? '') + output.slice(end);
          lastStart = start;
        }
      }

      writeFileSync(file.filePath, output);
    }
  }
}
