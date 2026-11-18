// Node unit tests for the radius math. Run: node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { math, install, version } = require('../leaflet-soundrings.js');

const EPS = 1e-6;
function close(actual, expected, eps = EPS) {
	assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual} (diff ${Math.abs(actual - expected)})`);
}

// Reference vectors shared with the trainhorn-calc core (Python, 49 tests):
// d = ref * 10^((src - L) / 20) in a free field.
const VECTORS = [
	// [sourceDb, refDistance, unit, level, expectedRadius]
	[150, 10, 'ft', 100, 3162.2776601683795],
	[150, 10, 'ft', 130, 100],
	[150, 10, 'ft', 90, 10000],
	[150, 10, 'ft', 150, 10],
	[150, 10, 'ft', 120, 316.22776601683796],
	[120, 1, 'm', 100, 10],
	[110, 100, 'ft', 70, 10000],
	[110, 100, 'ft', 85, 1778.2794100389228],
	[110, 100, 'ft', 120, 31.622776601683793],
	[96, 100, 'ft', 70, 1995.2623149688795]
];

test('free-field radius matches the core reference vectors within 1e-6', () => {
	for (const [src, ref, unit, level, expected] of VECTORS) {
		close(math.radiusFor(src, level, ref, unit, false), expected, Math.max(EPS, expected * 1e-12));
	}
});

test('150 dB @ 10 ft -> 100 dB at 3162.3 ft', () => {
	close(math.radiusFor(150, 100, 10, 'ft'), 3162.2776601683795);
	assert.equal(math.radiusFor(150, 100, 10, 'ft').toFixed(1), '3162.3');
});

test('unit does not change the free-field ratio', () => {
	close(math.radiusFor(140, 80, 10, 'm') / 10, math.radiusFor(140, 80, 10, 'ft') / 10, 1e-9);
});

test('levelAt is the inverse of radiusFor (free field)', () => {
	for (const [src, ref, unit, level] of VECTORS) {
		const r = math.radiusFor(src, level, ref, unit);
		close(math.levelAt(src, r, ref, unit), level, 1e-9);
	}
});

test('every 6.02 dB is a doubling of distance', () => {
	close(math.radiusFor(120, 120 - 20 * Math.log10(2), 1, 'm'), 2, 1e-12);
});

test('levelAt with absorption subtracts alpha*(d-ref)/1000 in metres', () => {
	const plain = math.levelAt(150, 1010, 10, 'm', 0);
	const absorbed = math.levelAt(150, 1010, 10, 'm', 2);
	close(plain - absorbed, 2, 1e-9);
	// feet are converted to metres for the absorption term (core vector)
	const pf = math.levelAt(150, 3290.84, 10, 'ft', 0);
	const af = math.levelAt(150, 3290.84, 10, 'ft', 10);
	close(pf - af, 10 * (3290.84 - 10) * 0.3048 / 1000, 1e-9);
});

test('absorption solve round-trips (iterative bisection)', () => {
	for (const d of [3, 50, 800, 5000]) {
		const level = math.levelAt(150, d, 10, 'm', 3.7);
		const back = math.radiusFor(150, level, 10, 'm', 3.7);
		close(back, d, d * 1e-9);
	}
	for (const d of [12, 400, 9000]) {
		const level = math.levelAt(110, d, 100, 'ft', true);
		close(math.radiusFor(110, level, 100, 'ft', true), d, d * 1e-9);
	}
});

test('absorption shortens rings beyond the reference and lengthens rings inside it', () => {
	assert.ok(math.radiusFor(150, 90, 10, 'ft', 1.9) < math.radiusFor(150, 90, 10, 'ft'));
	assert.ok(math.radiusFor(110, 120, 100, 'ft', 5) > math.radiusFor(110, 120, 100, 'ft'));
	close(math.radiusFor(110, 110, 100, 'ft', 5), 100, 1e-12);
});

test('absorption option: false/0 -> 0, true -> 1.9 dB/km, numbers pass through', () => {
	assert.equal(math.absorptionRate(false), 0);
	assert.equal(math.absorptionRate(0), 0);
	assert.equal(math.absorptionRate(true), 1.9);
	assert.equal(math.absorptionRate(3.7), 3.7);
	assert.throws(() => math.absorptionRate(-1), RangeError);
	assert.throws(() => math.absorptionRate(NaN), RangeError);
});

test('input validation', () => {
	assert.throws(() => math.radiusFor(150, 100, 0, 'ft'), /refDistance/);
	assert.throws(() => math.radiusFor(150, 100, -5, 'ft'), /refDistance/);
	assert.throws(() => math.radiusFor('150', 100, 10, 'ft'), /sourceDb/);
	assert.throws(() => math.radiusFor(150, Infinity, 10, 'ft'), /level/);
	assert.throws(() => math.radiusFor(150, 100, 10, 'yd'), /unit/);
	assert.throws(() => math.radiusFor(150, -1e6, 10, 'ft'), /too far apart/);
	assert.throws(() => math.levelAt(150, 0, 10, 'ft'), /distance/);
});

test('normalizeLevels sorts loudest first and drops duplicates', () => {
	assert.deepEqual(math.normalizeLevels([70, 120, 85, 100, 85]), [120, 100, 85, 70]);
	assert.throws(() => math.normalizeLevels([]), RangeError);
	assert.throws(() => math.normalizeLevels([90, 'x']), RangeError);
});

test('formatDistance', () => {
	assert.equal(math.formatDistance(3162.2776601683795, 'ft'), '3,162 ft');
	assert.equal(math.formatDistance(10000, 'ft'), '10,000 ft (1.89 mi)');
	assert.equal(math.formatDistance(31.622776601683793, 'ft'), '31.6 ft');
	assert.equal(math.formatDistance(1500, 'm'), '1,500 m (1.5 km)');
	assert.equal(math.formatDistance(3.16227, 'm'), '3.16 m');
});

test('unit conversions', () => {
	close(math.toMeters(10, 'ft'), 3.048, 1e-12);
	close(math.fromMeters(3.048, 'ft'), 10, 1e-12);
	assert.equal(math.toMeters(5, 'm'), 5);
});

test('install() rejects a missing Leaflet namespace; version is exported', () => {
	assert.throws(() => install(undefined), /install\(L\)/);
	assert.equal(version, '1.0.0');
});
