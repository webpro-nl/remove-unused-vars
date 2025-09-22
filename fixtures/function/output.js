export function empty() {
  return null;
}

export function emptyArg1(arg1, arg2) {
  return arg2;
}

export function emptyArg2(arg1,) {
  return arg1;
}

export function empty2() {
  return null;
}

export const arrowSingleArg = () => null;

export const arrowWithoutParens = () => null;

export const arrowEmptyArg1 = (a, b) => {
  return b;
}

export const arrowEmptyArg2 = (a,) => {
  return a;
}

export const arrowWithComment = () => {
  return null;
}
