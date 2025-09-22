export function empty(args) {
  return null;
}

export function emptyArg1(arg1, arg2) {
  return arg2;
}

export function emptyArg2(arg1, arg2) {
  return arg1;
}

export function empty2(args, args2) {
  return null;
}

export const arrowSingleArg = (a) => null;

export const arrowWithoutParens = a => null;

export const arrowEmptyArg1 = (a, b) => {
  return b;
}

export const arrowEmptyArg2 = (a, b) => {
  return a;
}

export const arrowWithComment = (a, /** with comment */ b) => {
  return null;
}
