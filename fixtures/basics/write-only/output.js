export function compute(seed) {
  let total = seed;
  total = seed + 1;
  return seed * 2;
}

export function iterate(items) {
  let item;
  for (item of items) {}
  let key;
  for (key in items) {}
  let first;
  [first] = items;
  let size;
  ({ length: size } = items);
  let length;
  ({ length } = items);
  let rest;
  [...rest] = items;
  let other;
  ({ ...other } = items);
  let nested;
  [(nested)] = items;
  let wrapped;
  (wrapped) = items;
  return items;
}
