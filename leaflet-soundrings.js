/*!
 * Leaflet.SoundRings 1.0.0
 * Concentric rings showing where the sound level of a point source falls to
 * chosen decibel levels (inverse-square law, optional air absorption).
 * https://github.com/train-horn/Leaflet.SoundRings
 * (c) 2026 Train Horn (https://train-horn.com/), MIT License
 */
(function (root, factory) {
	var api = factory();
	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	} else {
		root.LeafletSoundRings = api;
		// Leaflet 1.x (leaflet.js) and Leaflet 2.x (leaflet-global.js) both expose window.L.
		if (root.L && (root.L.FeatureGroup || root.L.featureGroup)) {
			api.install(root.L);
		}
	}
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
	'use strict';

	var FT_PER_M = 1 / 0.3048;
	var DEFAULT_ABSORPTION_DB_PER_KM = 1.9; // ~500 Hz octave band, 10 degC, 70 % RH (ISO 9613-1)
	var EARTH_RADIUS_M = 6371008.8;

	// ---------------------------------------------------------------- math --

	function fail(msg) {
		var err = new RangeError('Leaflet.SoundRings: ' + msg);
		throw err;
	}

	function finite(name, v) {
		if (typeof v !== 'number' || !isFinite(v)) { fail(name + ' must be a finite number, got ' + v); }
		return v;
	}

	function positive(name, v) {
		finite(name, v);
		if (!(v > 0)) { fail(name + ' must be greater than 0, got ' + v); }
		return v;
	}

	function checkUnit(unit) {
		if (unit !== 'ft' && unit !== 'm') { fail('unit must be "ft" or "m", got ' + unit); }
		return unit;
	}

	function toMeters(d, unit) { return unit === 'ft' ? d / FT_PER_M : d; }
	function fromMeters(m, unit) { return unit === 'ft' ? m * FT_PER_M : m; }

	/** Absorption option -> dB/km (false/0 -> 0, true -> default, number -> itself). */
	function absorptionRate(option) {
		if (option === true) { return DEFAULT_ABSORPTION_DB_PER_KM; }
		if (option === false || option === null || option === undefined || option === 0) { return 0; }
		finite('absorption', option);
		if (option < 0) { fail('absorption must be >= 0 dB/km, got ' + option); }
		return option;
	}

	/**
	 * Level (dB) at `distance` for a source of `sourceDb` at `refDistance`.
	 * L = src - 20*log10(d/ref) - alpha*(d - ref)/1000 (distances in metres for the alpha term).
	 */
	function levelAt(sourceDb, distance, refDistance, unit, absorptionDbPerKm) {
		finite('sourceDb', sourceDb);
		positive('distance', distance);
		positive('refDistance', refDistance);
		checkUnit(unit);
		var alpha = absorptionRate(absorptionDbPerKm);
		var level = sourceDb - 20 * Math.log10(distance / refDistance);
		if (alpha) {
			level -= alpha * (toMeters(distance, unit) - toMeters(refDistance, unit)) / 1000;
		}
		return level;
	}

	/**
	 * Distance (in `unit`) at which the level falls to `level` dB.
	 * Free field: ref * 10^((src - level)/20). With absorption the equation has
	 * no closed form, so it is solved by bisection (level decreases with distance).
	 */
	function radiusFor(sourceDb, level, refDistance, unit, absorptionDbPerKm) {
		finite('sourceDb', sourceDb);
		finite('level', level);
		positive('refDistance', refDistance);
		checkUnit(unit);
		var alpha = absorptionRate(absorptionDbPerKm);

		var free = refDistance * Math.pow(10, (sourceDb - level) / 20);
		if (!(free > 0) || !isFinite(free)) {
			fail('sourceDb and level ' + level + ' are too far apart to give a usable distance');
		}
		if (!alpha || free === refDistance) { return free; }

		// The root lies between the free-field answer and the reference distance.
		var lo = Math.min(free, refDistance);
		var hi = Math.max(free, refDistance);
		for (var i = 0; i < 200; i++) {
			var mid = 0.5 * (lo + hi);
			if (levelAt(sourceDb, mid, refDistance, unit, alpha) - level > 0) { lo = mid; } else { hi = mid; }
			if (hi - lo <= 1e-12 * hi) { break; }
		}
		return 0.5 * (lo + hi);
	}

	function normalizeLevels(levels) {
		if (!Array.isArray(levels) || !levels.length) { fail('levels must be a non-empty array of dB values'); }
		var seen = {};
		var out = [];
		for (var i = 0; i < levels.length; i++) {
			var v = finite('levels[' + i + ']', levels[i]);
			if (!seen[v]) { seen[v] = true; out.push(v); }
		}
		return out.sort(function (a, b) { return b - a; }); // loudest (smallest ring) first
	}

	function formatDistance(d, unit) {
		var digits = d >= 100 ? 0 : (d >= 10 ? 1 : 2);
		var text = d.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
		if (unit === 'ft' && d >= 5280) {
			text += ' ft (' + (d / 5280).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' mi)';
		} else if (unit === 'm' && d >= 1000) {
			text += ' m (' + (d / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' km)';
		} else {
			text += ' ' + unit;
		}
		return text;
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	var math = {
		levelAt: levelAt,
		radiusFor: radiusFor,
		absorptionRate: absorptionRate,
		normalizeLevels: normalizeLevels,
		formatDistance: formatDistance,
		toMeters: toMeters,
		fromMeters: fromMeters,
		DEFAULT_ABSORPTION_DB_PER_KM: DEFAULT_ABSORPTION_DB_PER_KM
	};

	// --------------------------------------------------------------- layer --

	var DEFAULTS = {
		sourceDb: 110,
		refDistance: 100,
		unit: 'ft',
		levels: [120, 100, 85, 70],
		absorption: false,
		// Array (cycled) or function(level, index) -> CSS color.
		colors: ['#b8411c', '#d9622b', '#e0a030', '#3f8a3a', '#2f6fb0', '#6b4fa0'],
		ringStyle: { weight: 2, opacity: 0.9, fillOpacity: 0.06 },
		labels: true,     // permanent text label on the north edge of each ring
		tooltips: true,   // hover tooltip on each ring
		popups: true,     // click popup on each ring
		showSource: true, // small circle marker at the source
		formatLabel: null // function(ring) -> string (plain text)
	};

	function install(L) {
		if (!L || !L.FeatureGroup) { throw new Error('Leaflet.SoundRings: pass the Leaflet namespace to install(L)'); }
		if (L.SoundRings && L.SoundRings.__soundRings) { return { SoundRings: L.SoundRings, soundRings: L.soundRings }; }

		var isV1 = typeof L.FeatureGroup.extend === 'function' && typeof L.featureGroup === 'function';

		function toLatLng(a) {
			if (typeof L.latLng === 'function') { return L.latLng(a); }
			return a instanceof L.LatLng ? a : new L.LatLng(a);
		}

		function northOf(latlng, meters) {
			var dLat = (meters / EARTH_RADIUS_M) * 180 / Math.PI;
			return new L.LatLng(Math.min(latlng.lat + dLat, 89.9), latlng.lng);
		}

		var methods = {
			_srInit: function (latlng, options) {
				var o = {};
				var k;
				for (k in DEFAULTS) { if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) { o[k] = DEFAULTS[k]; } }
				for (k in options || {}) { if (Object.prototype.hasOwnProperty.call(options, k)) { o[k] = options[k]; } }
				var style = {};
				for (k in DEFAULTS.ringStyle) { style[k] = DEFAULTS.ringStyle[k]; }
				for (k in (options && options.ringStyle) || {}) { style[k] = options.ringStyle[k]; }
				o.ringStyle = style;

				finite('sourceDb', o.sourceDb);
				positive('refDistance', o.refDistance);
				checkUnit(o.unit);
				absorptionRate(o.absorption);
				o.levels = normalizeLevels(o.levels);

				this.options = Object.assign({}, this.options || {}, o);
				this._latlng = toLatLng(latlng);
				this._rings = [];
				this._redraw();
			},

			/** Change the source level, and optionally the reference distance and unit. */
			setSource: function (sourceDb, refDistance, unit) {
				finite('sourceDb', sourceDb);
				if (refDistance !== undefined) { positive('refDistance', refDistance); }
				if (unit !== undefined) { checkUnit(unit); }
				this.options.sourceDb = sourceDb;
				if (refDistance !== undefined) { this.options.refDistance = refDistance; }
				if (unit !== undefined) { this.options.unit = unit; }
				return this._redraw();
			},

			/** Replace the list of dB levels to draw. */
			setLevels: function (levels) {
				this.options.levels = normalizeLevels(levels);
				return this._redraw();
			},

			/** false, true (1.9 dB/km) or a dB/km number. */
			setAbsorption: function (absorption) {
				absorptionRate(absorption);
				this.options.absorption = absorption;
				return this._redraw();
			},

			/** Display unit for radii, labels and refDistance: "ft" or "m". Converts refDistance. */
			setUnit: function (unit) {
				checkUnit(unit);
				if (unit !== this.options.unit) {
					this.options.refDistance = fromMeters(toMeters(this.options.refDistance, this.options.unit), unit);
					this.options.unit = unit;
				}
				return this._redraw();
			},

			setLatLng: function (latlng) {
				this._latlng = toLatLng(latlng);
				return this._redraw();
			},

			getLatLng: function () { return this._latlng; },

			/**
			 * Rings from loudest (smallest) to quietest (largest):
			 * [{ level, radius, unit, radiusMeters, color }]
			 */
			getRadii: function () {
				return this._rings.map(function (r) {
					return { level: r.level, radius: r.radius, unit: r.unit, radiusMeters: r.radiusMeters, color: r.color };
				});
			},

			_colorFor: function (level, i) {
				var c = this.options.colors;
				if (typeof c === 'function') { return c(level, i); }
				if (Array.isArray(c) && c.length) { return c[i % c.length]; }
				return '#b8411c';
			},

			_labelText: function (ring) {
				if (typeof this.options.formatLabel === 'function') { return String(this.options.formatLabel(ring)); }
				return ring.level + ' dB at ' + formatDistance(ring.radius, ring.unit);
			},

			_computeRings: function () {
				var o = this.options;
				var rings = [];
				for (var i = 0; i < o.levels.length; i++) {
					var level = o.levels[i];
					var radius = radiusFor(o.sourceDb, level, o.refDistance, o.unit, o.absorption);
					rings.push({
						level: level,
						radius: radius,
						unit: o.unit,
						radiusMeters: toMeters(radius, o.unit),
						color: this._colorFor(level, i)
					});
				}
				return rings;
			},

			_redraw: function () {
				var rings = this._computeRings(); // throws before touching the map on bad input
				this.clearLayers();
				this._rings = rings;
				var o = this.options;
				var center = this._latlng;

				// Largest ring first so smaller rings stay on top and clickable.
				for (var i = rings.length - 1; i >= 0; i--) {
					var ring = rings[i];
					var style = Object.assign({}, o.ringStyle, { color: ring.color, fillColor: ring.color, radius: ring.radiusMeters });
					var circle = new L.Circle(center, style);
					circle.soundRing = ring;
					var text = this._labelText(ring);
					if (o.tooltips) { circle.bindTooltip(escapeHtml(text), { sticky: true, direction: 'top' }); }
					if (o.popups) {
						circle.bindPopup(
							'<strong>' + escapeHtml(ring.level) + ' dB</strong><br>' +
							escapeHtml(formatDistance(ring.radius, ring.unit)) + ' from the source<br>' +
							'<small>Source: ' + escapeHtml(o.sourceDb) + ' dB at ' + escapeHtml(formatDistance(o.refDistance, o.unit)) +
							(absorptionRate(o.absorption) ? ', air absorption ' + escapeHtml(absorptionRate(o.absorption)) + ' dB/km' : ', free field') +
							'. Estimate, not a measurement.</small>'
						);
					}
					this.addLayer(circle);

					if (o.labels) {
						var icon = new L.DivIcon({
							className: 'leaflet-soundrings-label',
							html: '<span style="border-color:' + escapeHtml(ring.color) + '">' + escapeHtml(text) + '</span>',
							iconSize: null
						});
						this.addLayer(new L.Marker(northOf(center, ring.radiusMeters), { icon: icon, interactive: false, keyboard: false }));
					}
				}
				if (o.showSource) {
					this.addLayer(new L.CircleMarker(center, {
						radius: 5, color: '#1a1a1a', weight: 2, fillColor: '#ffffff', fillOpacity: 1, interactive: false
					}));
				}
				this.fire('soundrings:update', { rings: this.getRadii() });
				return this;
			}
		};

		var SoundRings;
		if (isV1) {
			var proto = {
				initialize: function (latlng, options) {
					L.FeatureGroup.prototype.initialize.call(this, []);
					this._srInit(latlng, options);
				}
			};
			for (var m in methods) { if (Object.prototype.hasOwnProperty.call(methods, m)) { proto[m] = methods[m]; } }
			SoundRings = L.FeatureGroup.extend(proto);
		} else {
			// Leaflet 2: plain ES classes, constructor() instead of initialize().
			SoundRings = class SoundRings extends L.FeatureGroup {
				constructor(latlng, options) {
					super([]);
					this._srInit(latlng, options);
				}
			};
			Object.keys(methods).forEach(function (name) {
				Object.defineProperty(SoundRings.prototype, name, { value: methods[name], writable: true, configurable: true });
			});
		}
		SoundRings.__soundRings = true;
		SoundRings.math = math;

		function soundRings(latlng, options) { return new SoundRings(latlng, options); }

		try {
			L.SoundRings = SoundRings;
			L.soundRings = soundRings;
		} catch (e) { /* frozen ES module namespace: use the return value instead */ }

		injectCss();
		return { SoundRings: SoundRings, soundRings: soundRings };
	}

	function injectCss() {
		if (typeof document === 'undefined' || document.getElementById('leaflet-soundrings-css')) { return; }
		var style = document.createElement('style');
		style.id = 'leaflet-soundrings-css';
		style.textContent =
			'.leaflet-soundrings-label{background:none;border:0}' +
			'.leaflet-soundrings-label span{display:inline-block;transform:translate(-50%,-50%);white-space:nowrap;' +
			'font:600 11px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a;background:rgba(255,255,255,.88);' +
			'border:1px solid;border-radius:3px;padding:1px 5px;pointer-events:none}';
		(document.head || document.documentElement).appendChild(style);
	}

	return { install: install, math: math, version: '1.0.0' };
}));
