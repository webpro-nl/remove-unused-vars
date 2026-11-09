import kept, { unused, other, first, last as discarded } from './values.mjs';
export function read(other) {
  return other;
}
console.log(kept + first - 42, read(7));
