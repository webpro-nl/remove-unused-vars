try {
  throw new Error('test');
} catch {
  console.log('catch');
} finally {
  console.log('finally');
}

try {
  throw new Error('test');
} catch {}