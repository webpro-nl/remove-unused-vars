const { unusedA, ...unusedRest } = { unusedA: 1, other: 2 }, [unusedB, ...unusedTail] = [1, 2], kept = 42;
console.log(kept);
