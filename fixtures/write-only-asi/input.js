export function run(seed) {
  const fn = () => seed
  let dead = seed
  dead = seed + 1
  ;(fn)()
  return seed
}
