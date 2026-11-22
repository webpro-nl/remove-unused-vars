const kept = [42]
function unused() {}
[kept].forEach(x => console.log(x[0]))
