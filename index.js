#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const WRITE_ONLY_BAIL = Symbol('write-only-bail');

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
  for (let charOffset = 0; charOffset < source.length; charOffset++) {
    byteToChar.set(byteOffset, charOffset);
    byteOffset += encoder.encode(source[charOffset]).length;
  }
  byteToChar.set(byteOffset, source.length);
  return byteOffset => byteToChar.get(byteOffset) ?? source.length;
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
      const location = diagnostic.location;
      const filePath = typeof location.path === 'string' ? location.path : location.path.file;
      if (!output[filePath]) {
        output[filePath] = {
          filePath,
          positions: [],
          source: location.sourceCode,
          byteToChar: location.sourceCode ? createByteToCharConverter(location.sourceCode) : null,
        };
      }
      output[filePath].positions.push(
        location.start
          ? [location.start.line - 1, location.start.column - 1]
          : output[filePath].byteToChar(location.span[0]),
      );
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
        output[filePath] = { filePath, positions: [] };
      }
      const span = result.labels[0].span;
      output[filePath].positions.push([span.line - 1, span.column - 1]);
      return output;
    }, {});
  return Object.values(groupedByFile);
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
            const text = source.slice(range[0], range[1]);
            if (range && varName) {
              const offset = text.lastIndexOf(varName);
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
  if (ts.isBinaryExpression(parent) && parent.left === id && ts.isAssignmentOperator(parent.operatorToken.kind))
    return true;
  if ((ts.isPostfixUnaryExpression(parent) || ts.isPrefixUnaryExpression(parent)) && parent.operand === id) {
    return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
  }
  return false;
}

function namesProperty(id) {
  const parent = id.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === id) ||
    (ts.isPropertyAssignment(parent) && parent.name === id)
  );
}

function functionScopeOf(node) {
  let n = node.parent;
  while (
    n &&
    !ts.isSourceFile(n) &&
    !ts.isFunctionDeclaration(n) &&
    !ts.isFunctionExpression(n) &&
    !ts.isArrowFunction(n) &&
    !ts.isMethodDeclaration(n) &&
    !ts.isConstructorDeclaration(n) &&
    !ts.isGetAccessorDeclaration(n) &&
    !ts.isSetAccessorDeclaration(n)
  ) {
    n = n.parent;
  }
  return n;
}

function isInside(node, ancestor) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

/**
 * Whether `name` is an assignment target (`x = 1`, `x += 1`, `x++`) anywhere in its enclosing
 * function scope. The catch/parameter/destructuring-binding paths bail when it is: dropping the
 * binding would leave the write pointing at an undeclared variable. A same-named binding in a
 * sibling block also counts, so this can over-bail, which is safe.
 */
function isReassignedInScope(name, node) {
  let found = false;
  const walk = n => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name && !namesProperty(n) && isWriteTarget(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(functionScopeOf(node));
  return found;
}

function isSideEffectFree(node) {
  if (ts.isParenthesizedExpression(node)) return isSideEffectFree(node.expression);
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return isSideEffectFree(node.expression);
  if (ts.isIdentifier(node) || ts.isLiteralExpression(node)) return true;
  switch (node.kind) {
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return true;
  }
  if (ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) return false;
    return isSideEffectFree(node.operand);
  }
  if (ts.isBinaryExpression(node)) {
    if (ts.isAssignmentOperator(node.operatorToken.kind) || node.operatorToken.kind === ts.SyntaxKind.CommaToken)
      return false;
    return isSideEffectFree(node.left) && isSideEffectFree(node.right);
  }
  if (ts.isConditionalExpression(node))
    return isSideEffectFree(node.condition) && isSideEffectFree(node.whenTrue) && isSideEffectFree(node.whenFalse);
  if (ts.isTemplateExpression(node)) return node.templateSpans.every(span => isSideEffectFree(span.expression));
  if (ts.isArrayLiteralExpression(node))
    return node.elements.every(el => !ts.isSpreadElement(el) && isSideEffectFree(el));
  if (ts.isObjectLiteralExpression(node))
    return node.properties.every(p => {
      if (ts.isPropertyAssignment(p)) return !ts.isComputedPropertyName(p.name) && isSideEffectFree(p.initializer);
      return ts.isShorthandPropertyAssignment(p);
    });
  return false;
}

/**
 * A write-only variable (declared, assigned, never read) can't be removed at a single
 * position: ESLint flags the write reference, Biome/oxlint flag the declaration. Resolve
 * the whole binding and remove the declaration plus every write, but only when provably
 * safe (every initializer and RHS is side-effect-free). Otherwise bail so side effects survive.
 *
 * @returns {null} not a write-only variable (caller keeps its existing behavior)
 * @returns {typeof WRITE_ONLY_BAIL} write-only but unsafe to remove, leave untouched
 * @returns {{start:number,end:number}[]} ranges to remove (declaration + writes)
 */
function planWriteOnlyRemoval(token, processed) {
  if (!ts.isIdentifier(token)) return null;
  const flaggedDeclaration = ts.isVariableDeclaration(token.parent) && token.parent.name === token;
  if (!flaggedDeclaration && !isWriteTarget(token)) return null;

  // `using`/`await using` bindings dispose their resource at scope exit; removing one would
  // silently drop that side effect.
  if (
    flaggedDeclaration &&
    ts.isVariableDeclarationList(token.parent.parent) &&
    token.parent.parent.flags & ts.NodeFlags.Using
  )
    return WRITE_ONLY_BAIL;

  const name = token.text;

  // Resolve within the binding's own function scope so unrelated, same-named variables
  // in sibling functions never interfere with name matching.
  const scope = functionScopeOf(flaggedDeclaration ? token.parent : token);
  const occurrences = [];
  let declaration = null;
  let declarationCount = 0;
  const walk = node => {
    if (ts.isIdentifier(node) && node.text === name && !namesProperty(node)) occurrences.push(node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      functionScopeOf(node) === scope
    ) {
      declaration = node;
      declarationCount++;
    }
    ts.forEachChild(node, walk);
  };
  walk(scope);

  const writes = occurrences.filter(isWriteTarget);

  // Defer to the existing unused-variable removal only when the declaration name is the sole
  // occurrence. If there are other references not recognized as writes (e.g. a
  // destructuring-assignment target `[x] = arr`), removing just the declaration would leave a
  // dangling write, so fall through and let the guards below bail instead.
  if (flaggedDeclaration && occurrences.length === 1) return null;

  // From here on it's a write-only variable: return ranges or bail, never fall through.
  if (declarationCount !== 1 || !declaration) return WRITE_ONLY_BAIL;
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list) || list.declarations.length !== 1) return WRITE_ONLY_BAIL;
  const statement = list.parent;
  if (!ts.isVariableStatement(statement)) return WRITE_ONLY_BAIL;
  if (processed.has(statement.pos)) return WRITE_ONLY_BAIL;

  // Every reference must live in the declaration's own scope; a reference inside a nested
  // function (closure) may run across calls, so removing the writes isn't safe.
  for (const id of occurrences) if (functionScopeOf(id) !== scope) return WRITE_ONLY_BAIL;

  // Every reference must also share the declaration's lexical scope. let/const are
  // block-scoped, so a same-named identifier in a sibling or outer block is a different
  // binding (var is function-scoped). Without this, a write to that other binding (say a
  // shadowed module-level variable) would be wrongly removed.
  const blockScoped = list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const);
  const lexicalScope = blockScoped ? statement.parent : scope;
  for (const id of occurrences) if (!isInside(id, lexicalScope)) return WRITE_ONLY_BAIL;

  const writeStatements = [];
  for (const id of writes) {
    const expression = id.parent;
    const writeStatement = expression.parent;
    if (!ts.isExpressionStatement(writeStatement) || writeStatement.expression !== expression) return WRITE_ONLY_BAIL;
    const container = writeStatement.parent;
    if (!ts.isBlock(container) && !ts.isSourceFile(container) && !ts.isModuleBlock(container)) return WRITE_ONLY_BAIL;
    if (ts.isBinaryExpression(expression) && !isSideEffectFree(expression.right)) return WRITE_ONLY_BAIL;
    writeStatements.push(writeStatement);
  }

  const removable = [statement, ...writeStatements];
  for (const id of occurrences) {
    if (id === declaration.name || isWriteTarget(id)) continue;
    if (!removable.some(node => isInside(id, node))) return WRITE_ONLY_BAIL;
  }

  if (declaration.initializer && !isSideEffectFree(declaration.initializer)) return WRITE_ONLY_BAIL;

  processed.add(statement.pos);
  return removable.map(node => ({ start: node.getFullStart(), end: node.getEnd() }));
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
    const processedBindings = new Set();
    const processedWriteOnly = new Set();

    const positions = file.positions
      .map(p => {
        const pos = getPos(sourceFile, p);
        const token = ts.getTokenAtPosition(sourceFile, pos);

        if (token.parent) {
          if (ts.isCatchClause(token.parent.parent)) {
            // A reassigned catch binding (`catch (e) { e = 1 }`) can't be dropped: the write
            // would dangle. Leave it in place.
            if (ts.isIdentifier(token) && isReassignedInScope(token.text, token)) return null;
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

            // A reassigned destructured binding (`let { x } = o; x = 1`) can't be dropped: the
            // write would dangle. Leave it in place.
            if (ts.isIdentifier(token) && isReassignedInScope(token.text, token)) return null;

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
                    // Removing the whole statement would drop sibling declarators (e.g. the live
                    // `c` in `let { a, b } = o, c = 2`). Only safe when this is the sole declarator.
                    if (
                      ts.isVariableDeclarationList(variableDeclarationList) &&
                      variableDeclarationList.declarations.length !== 1
                    )
                      return null;
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
            // A reassigned parameter (`function f(p){ p = 1 }`) can't be dropped: the write
            // would dangle. Leave it in place.
            if (ts.isIdentifier(token) && isReassignedInScope(token.text, token)) return null;
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

        const plan = planWriteOnlyRemoval(token, processedWriteOnly);
        if (plan === WRITE_ONLY_BAIL) return null;
        if (plan) return plan;

        const node = findParentDeclaration(token);

        if (!node) return null;

        // Only remove when the flagged token is the declaration's binding name. A stray
        // reference (e.g. a write that planWriteOnlyRemoval could not safely resolve) would
        // otherwise delete the whole enclosing declaration.
        const declarationName = ts.isVariableStatement(node)
          ? ts.isVariableDeclaration(token.parent) && token.parent.name === token
            ? token
            : null
          : node.name;
        if (declarationName !== token) return null;

        return { start: node.getFullStart(), end: node.getEnd() };
      })
      .flat()
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
          let cut = end;
          // Preserve a trailing `;` that terminates the removed statement when the next statement
          // relies on it to avoid ASI fusion (semicolon-free style: `;[x]`, `;(f)()`). TypeScript
          // attaches that guard `;` to the end of the preceding statement, so removing the
          // statement would otherwise swallow it and merge two lines into one.
          if (replacement === undefined && source[cut - 1] === ';') {
            let i = cut;
            while (i < source.length && /\s/.test(source[i])) i++;
            if (i < source.length && '([`+-/'.includes(source[i])) cut -= 1;
          }
          output = output.slice(0, start) + (replacement ?? '') + output.slice(cut);
          lastStart = start;
        }
      }

      writeFileSync(file.filePath, output);
    }
  }
}
