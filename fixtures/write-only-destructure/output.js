export function f(arr, o) {
  let x = 0;
  let y = 0;
  [x] = arr;
  ({ y } = o);
  return 1;
}
