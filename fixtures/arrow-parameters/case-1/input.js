async function run(callback) { console.log(await callback(1, 2)); }
const fn = unused => 42; await run(fn);
