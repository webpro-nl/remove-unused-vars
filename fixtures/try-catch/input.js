try {
  throw new Error('test');
} catch (e) {
  console.log('catch');
  function hello() {}
} finally {
  console.log('finally');
}

try {
  throw new Error('test');
} catch (/** test */e ) {}