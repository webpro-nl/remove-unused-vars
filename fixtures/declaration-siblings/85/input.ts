const kept = [42]
type Unused = number
;[kept].forEach(x => console.log(x[0]))
