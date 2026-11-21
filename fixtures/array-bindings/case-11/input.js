const [unused = Math.max(7, 8), ...rest] = [undefined, 42, 43];
console.log(JSON.stringify(rest));
