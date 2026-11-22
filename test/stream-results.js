import { beforeEach } from 'node:test';
import { setImmediate } from 'node:timers/promises';

// Let the runner publish the previous result before the next synchronous CLI call.
beforeEach(() => setImmediate());
