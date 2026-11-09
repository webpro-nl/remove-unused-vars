const { unused /* keep, comment */, ...kept } = { value: 42 };
console.log(kept.value);
