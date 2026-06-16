export let shared = 0;
export function tick() {
  { let shared = 0; }
  shared = 1;
}
