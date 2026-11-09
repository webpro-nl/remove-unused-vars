import { unused, Kept, other } from './values.mjs';
/** @param {Kept} value */
export function read(value) {
  return value.value;
}
