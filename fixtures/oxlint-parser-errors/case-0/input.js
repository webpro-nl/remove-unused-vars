const unused = 1;
const { first, /* punctuation, stays inside this declaration */ second } = { first: 1, second: 2 };
export function kept(value) {
  let pending = 0;
  pending = value;
  return value * 2;
}
console.log(kept(21));
