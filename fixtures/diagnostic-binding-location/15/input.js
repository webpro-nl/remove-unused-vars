const { msg = { msg: 0 }, ...kept } = { msg: 7, value: 42 };
console.log(JSON.stringify(kept));
