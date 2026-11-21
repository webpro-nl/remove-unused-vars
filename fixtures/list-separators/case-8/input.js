const { ['a,b']: unused = Math.max(1, 2), kept } = { kept: 42 };
console.log(kept);
