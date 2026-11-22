import { bool } from './util';
import { bool2 } from './util/v2';

const a = 1;

function b() {
  console.log(a)
}

[1,2,3].map((a) => null);

[1,2,3].map((a, index) => a);

function Hello(arg1) {
  return 2;
}

Hello();

function World(arg1) {
  return 3;
}

bool2();