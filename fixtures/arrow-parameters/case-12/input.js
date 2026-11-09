async function run(callback) { console.log(await callback(1, 2)); }
await run(unused => 42); await run((other) => 43); await run((async third => 44));
