async function run(callback) { console.log(await callback(1, 2)); }
const fn = () => 42; await run(fn);
