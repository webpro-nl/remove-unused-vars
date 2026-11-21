const { a: unusedA /* first, comment */, kept, b: unusedB /* last, comment */, } = { kept: 42 };
console.log(kept);
