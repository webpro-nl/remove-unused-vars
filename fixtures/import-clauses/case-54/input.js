import kept, { unused, other, first, last as discarded } from './values.mjs';
console.log(kept + first - 42, { other: 7 }.other);
