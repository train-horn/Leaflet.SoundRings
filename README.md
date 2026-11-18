# Leaflet.SoundRings

A [Leaflet](https://leafletjs.com/) plugin that draws concentric circles around a point sound source, one for each decibel level you ask for. Each circle marks the distance at which the source's sound pressure level (SPL) falls to that level, using the inverse-square law:

```
radius = refDistance × 10^((sourceDb − level) / 20)
```

An optional, approximate air-absorption term can be switched on; the radius is then solved iteratively.

**Demo:** https://train-horn.github.io/Leaflet.SoundRings/ (add `?leaflet=2` for Leaflet 2.0 beta)

Works with Leaflet **1.9.4** and **2.0.0-beta.4** (tested on both). No dependencies besides Leaflet. Single file, under 5 KB gzipped.

## Usage

```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="leaflet-soundrings.js"></script>
<script>
  const map = L.map('map').setView([34.3925, -118.5355], 14);

  // A locomotive horn at a grade crossing. US rules (49 CFR 229.129) require
  // 96–110 dB(A) at 100 ft in front of the locomotive; this uses the maximum.
  const rings = L.soundRings([34.3925, -118.5355], {
    sourceDb: 110,
    refDistance: 100,
    unit: 'ft',
    levels: [120, 100, 85, 70]
  }).addTo(map);

  rings.getRadii();
  // [{ level: 120, radius: 31.6,   unit: 'ft', radiusMeters: 9.6,    color: '#b8411c' },
  //  { level: 100, radius: 316.2,  ... },
  //  { level: 85,  radius: 1778.3, ... },
  //  { level: 70,  radius: 10000,  ... }]
</script>
```

The layer is a `FeatureGroup`, so `addTo`, `remove`, `getBounds`, `on`, etc. all work. Ring 120 dB lies *inside* the 100 ft reference distance here; that is expected when a level is louder than the rated level.

### Leaflet 2.0

With `leaflet-global.js` the plugin installs itself on `window.L` just like with 1.9.4. With the ES module build, load the plugin with a `<script>` tag and pass the namespace in:

```html
<script src="leaflet-soundrings.js"></script>
<script type="module">
  import * as L from 'https://cdn.jsdelivr.net/npm/leaflet@2.0.0-beta.4/dist/leaflet.js';
  const { soundRings } = LeafletSoundRings.install(L);
  const map = new L.Map('map').setView([34.3925, -118.5355], 14);
  soundRings([34.3925, -118.5355], { sourceDb: 110, refDistance: 100 }).addTo(map);
</script>
```

In Node / bundlers, `require('leaflet.soundrings')` returns `{ install, math, version }`.

## Options

| Option | Default | Description |
|---|---|---|
| `sourceDb` | `110` | Level of the source in dB at `refDistance`. |
| `refDistance` | `100` | Distance at which `sourceDb` applies (> 0), in `unit`. |
| `unit` | `'ft'` | `'ft'` or `'m'`. Used for `refDistance`, radii and labels. |
| `levels` | `[120, 100, 85, 70]` | dB levels to draw. Sorted loudest first, duplicates dropped. |
| `absorption` | `false` | `false`, `true` (1.9 dB/km, roughly the 500 Hz octave band at 10 °C / 70 % RH from ISO 9613-1) or a number in dB/km. |
| `colors` | rust → green → blue | Array (cycled) or `function(level, index)` returning a CSS color. |
| `ringStyle` | `{ weight: 2, opacity: 0.9, fillOpacity: 0.06 }` | Extra `Path` options for every ring. |
| `labels` | `true` | Permanent text label at the north edge of each ring. |
| `tooltips` | `true` | Hover tooltip on each ring ("85 dB at 1,778 ft"). |
| `popups` | `true` | Click popup with the level, distance and source settings. |
| `showSource` | `true` | Small marker at the source point. |
| `formatLabel` | `null` | `function(ring)` returning the label/tooltip text. |

## Methods

| Method | Returns | Description |
|---|---|---|
| `setSource(sourceDb, refDistance?, unit?)` | `this` | Change the source level (and optionally the reference distance and unit). |
| `setLevels(levels)` | `this` | Replace the dB levels. |
| `setAbsorption(absorption)` | `this` | `false`, `true` or dB/km. |
| `setUnit(unit)` | `this` | Switch between `'ft'` and `'m'`; `refDistance` is converted. |
| `setLatLng(latlng)` / `getLatLng()` | `this` / `LatLng` | Move or read the source position. |
| `getRadii()` | `Array` | `[{ level, radius, unit, radiusMeters, color }]`, loudest (smallest) first. |

Invalid input (non-numeric levels, `refDistance <= 0`, unknown unit, negative absorption) throws a `RangeError` and leaves the existing rings unchanged.

**Event:** `soundrings:update` fires after every redraw with `{ rings }`.

**Math helpers:** `LeafletSoundRings.math.radiusFor(sourceDb, level, refDistance, unit, absorption)` and `levelAt(sourceDb, distance, refDistance, unit, absorption)` are available without a map.

## Limitations

- **Free field only.** The model assumes a small point source in open air: no terrain, buildings, barriers, ground reflection, wind or temperature gradients. Real outdoor levels can be several dB higher or lower.
- **Air absorption is approximate.** It depends strongly on frequency, temperature and humidity; a single dB/km figure is a rough guide and matters only at long range.
- **Not valid very close to the source** (within about one or two source sizes).
- **The rings are estimates, not measurements**, and not a legal noise assessment. The dB figures you enter (rated, claimed or regulatory) are only as good as their source.
- Very large radii (thousands of km) are drawn as Leaflet circles and are not geodesically exact.

## Tests

```
npm test            # node --test: radius math against reference vectors (within 1e-6)
npm install --no-save jsdom && npm run test:smoke   # smoke.html on Leaflet 1.9.4 and 2.0 beta in jsdom
```

`test/smoke.html` runs the plugin on a real map in the browser (`?leaflet=1` or `?leaflet=2`). It is also published with the demo: https://train-horn.github.io/Leaflet.SoundRings/test/smoke.html

The reference vectors (for example 150 dB at 10 ft → 100 dB at 3162.28 ft) are shared with the `trainhorn-calc` core library ([GitHub](https://github.com/train-horn/trainhorn-calc)), which uses the same formula as the [Train Horn decibel distance calculator](https://train-horn.com/tools/decibel-distance/).

## Credits

Made by [Train Horn](https://train-horn.com/), an independent reference on train horns. This plugin was written with the help of an AI coding assistant and reviewed and tested by us; it contains no AI features.

## License

MIT
