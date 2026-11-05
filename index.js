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
          source,
          toChar: location.start ? createLineColumnToCharConverter(source) : createByteToCharConverter(source),
        };
      }
      output[filePath].positions.push(output[filePath].toChar(location.start ?? location.span[0]));
      return output;
    }, {});
  return Object.values(groupedByFile).map(({ filePath, positions, source }) => ({ filePath, positions, source }));
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
      const bomOffset = source.charCodeAt(0) === 0xfeff ? 1 : 0;
      return {
        filePath: result.filePath,
        // Suggestions can cover whole declarations, including other occurrences of the name.
        // Use the reported identifier; write-only reports still pass through the reassignment guards.
        positions: result.messages
          .filter(predicate)
          .map(msg => [msg.line - 1, msg.column - 1 + (msg.line === 1 ? bomOffset : 0)]),
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

function isReassigned(name, sourceFile) {
  let reassigned = false;
  const visit = node => {
    if (reassigned) return;
    if (ts.isIdentifier(node) && node.text === name && isWriteTarget(node)) reassigned = true;
    else ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return reassigned;
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
    const removedDeclarations = new Set();

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
                    removedDeclarations.add(variableDeclaration);
                    return null;
                  }
                }
              }
            }

            const restElement = ts.isObjectBindingPattern(bindingPattern)
              ? bindingPattern.elements.find(element => element.dotDotDotToken)
              : undefined;
            if (
              restElement &&
              restElement !== bindingElement &&
              !file.positions.some(p => ts.getTokenAtPosition(sourceFile, getPos(sourceFile, p)).parent === restElement)
            ) {
              return null;
            }

            const start = bindingElement.getFullStart();
            let end = bindingElement.getEnd();
            if (!ts.isArrayBindingPattern(bindingPattern) && bindingElement !== bindingPattern.elements.at(-1)) {
              const comma = ts.findNextToken(bindingElement, sourceFile);
              if (comma?.kind !== ts.SyntaxKind.CommaToken) return null;
              end = comma.getEnd();
            }
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
            if (!isLastParameter) {
              const comma = ts.findNextToken(parameter, sourceFile);
              if (comma?.kind !== ts.SyntaxKind.CommaToken) return null;
              end = comma.getEnd();
            }
            return { start, end };
          }

          if (ts.isImportClause(token.parent)) {
            const importDecl = token.parent.parent;
            const nextToken = ts.findNextToken(importDecl, sourceFile);
            const end = nextToken ? nextToken.getFullStart() : source.length;
            return { start: importDecl.getFullStart(), end };
          }

          if (ts.isImportSpecifier(token.parent)) {
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
            } else {
              start = source.lastIndexOf(',', start);
            }
            return { start, end };
          }

          if (ts.isNamespaceImport(token.parent)) {
            const namespaceImport = token.parent;
            const importDecl = namespaceImport.parent.parent;
            const nextToken = ts.findNextToken(importDecl, sourceFile);
            const end = nextToken ? nextToken.getFullStart() : source.length;
            return { start: importDecl.getFullStart(), end };
          }

          if (ts.isImportDeclaration(token.parent)) return null;
        }

        const node = findParentDeclaration(token);

        if (!node) return null;

        if (!isDeclarationName(token, node) || isReassigned(token.text, sourceFile)) return null;

        if (ts.isVariableStatement(node)) {
          if (token.parent.parent !== node.declarationList) return null;
          removedDeclarations.add(token.parent);
          return null;
        }

        const statements = node.parent.statements;
        const next = statements?.[statements.indexOf(node) + 1];
        const needsBody =
          (ts.isFunctionDeclaration(node) && (ts.isIfStatement(node.parent) || ts.isLabeledStatement(node.parent))) ||
          (next && ts.isExpressionStatement(next) && ts.isStringLiteral(next.expression));
        return { start: node.getFullStart(), end: node.getEnd(), replacement: needsBody ? ';' : '' };
      })
      .filter(Boolean);

    const declarationLists = new Set([...removedDeclarations].map(declaration => declaration.parent));
    const removedStatements = new Set(
      [...declarationLists]
        .filter(list => list.declarations.every(declaration => removedDeclarations.has(declaration)))
        .map(list => list.parent),
    );
    const removalsByEnd = new Map(positions.map(position => [position.end, position]));
    const isRemovedStatement = statement => {
      const removal = removalsByEnd.get(statement.getEnd());
      return (
        removedStatements.has(statement) ||
        (removal && removal.start <= statement.getStart(sourceFile) && !removal.replacement)
      );
    };
    for (const declarationList of declarationLists) {
      const declarations = declarationList.declarations;
      if (removedStatements.has(declarationList.parent)) {
        const statement = declarationList.parent;
        const parent = statement.parent;
        const statementIndex = parent.statements?.indexOf(statement) ?? -1;
        let previousIndex = statementIndex - 1;
        let previous = statementIndex > 0 ? parent.statements[previousIndex] : undefined;
        while (previous && isRemovedStatement(previous)) previous = parent.statements[--previousIndex];
        let nextIndex = statementIndex + 1;
        let next = statementIndex >= 0 ? parent.statements[nextIndex] : undefined;
        while (next && isRemovedStatement(next)) next = parent.statements[++nextIndex];
        const needsBody =
          ts.isIfStatement(parent) ||
          ts.isIterationStatement(parent, false) ||
          ts.isLabeledStatement(parent) ||
          ts.isWithStatement(parent) ||
          (previous && previous.getLastToken(sourceFile)?.kind !== ts.SyntaxKind.SemicolonToken) ||
          (next && ts.isExpressionStatement(next) && ts.isStringLiteral(next.expression));
        positions.push({
          start: statement.getFullStart(),
          end: statement.getEnd(),
          replacement: needsBody ? ';' : '',
        });
        continue;
      }

      for (let first = 0; first < declarations.length; first++) {
        if (!removedDeclarations.has(declarations[first])) continue;
        let last = first;
        while (last + 1 < declarations.length && removedDeclarations.has(declarations[last + 1])) last++;

        // Remove adjacent declarators together so their comma ranges never overlap.
        // AST boundaries also keep commas inside comments out of separator handling.
        const isLast = last === declarations.length - 1;
        const precedingComma = isLast ? ts.findNextToken(declarations[first - 1], sourceFile) : undefined;
        if (isLast && precedingComma?.kind !== ts.SyntaxKind.CommaToken) continue;
        positions.push({
          start: isLast ? precedingComma.getStart(sourceFile) : declarations[first].getFullStart(),
          end: isLast ? declarations[last].getEnd() : declarations[last + 1].getFullStart(),
          replacement: first === 0 ? ' ' : '',
        });
        first = last;
      }
    }

    if (positions.length > 0) {
      let output = source;
      const shebangEnd = source.match(/^#![^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029]|$)/)?.[0].length ?? 0;
      positions.sort((a, b) => {
        return b.end - a.end;
      });

      let lastStart = Infinity;
      for (const { start, end, replacement } of positions) {
        // skip covered positions
        if (end <= lastStart) {
          // Keep the executable directive outside every removal range.
          output = output.slice(0, Math.max(start, shebangEnd)) + (replacement ?? '') + output.slice(end);
          lastStart = start;
        }
      }

      writeFileSync(file.filePath, output);
    }
  }
}
