import { workingMsBetween } from '../src/utils/businessHours.js';

function assertEqual(a, b, msg) {
  if (a !== b) {
    console.error('FAIL:', msg, 'expected', b, 'got', a);
    process.exit(2);
  }
}

// Helper to build Date in local timezone
function d(str) { return new Date(str).getTime(); }

// Test 1: single day inside business hours
const s1 = d('2025-08-20T09:00:00'); // Wed
const e1 = d('2025-08-20T11:00:00');
assertEqual(workingMsBetween(s1,e1), (2*60*60*1000), 'simple same-day');

// Test 2: before business start -> clipped
const s2 = d('2025-08-20T06:00:00');
const e2 = d('2025-08-20T09:00:00');
assertEqual(workingMsBetween(s2,e2), (1*60*60*1000), 'clipped start');

// Test 3: across weekend (Fri->Mon)
const s3 = d('2025-08-22T16:00:00'); // Fri
const e3 = d('2025-08-25T10:00:00'); // Mon
// Fri 16:00->17:30 = 1.5h, Mon 08:00->10:00 = 2h => 3.5h
assertEqual(workingMsBetween(s3,e3), (3.5*60*60*1000), 'weekend skip');

console.log('ALL TESTS PASSED');
process.exit(0);
