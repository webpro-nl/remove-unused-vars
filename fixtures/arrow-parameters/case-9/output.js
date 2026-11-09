async function run(callback) { console.log(await callback(1, 2)); }
await run(( /* ), */) => 42);
