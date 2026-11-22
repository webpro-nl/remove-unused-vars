const utils = { foo: 1, bar: 2, baz: 3 };
const { foo, bar, baz } = utils;

console.log('All object destructured elements are unused');

const arr = [1, 2, 3];
const [x, y, z] = arr;

console.log('All array destructured elements are unused');
