// Runs test/smoke.html in jsdom against Leaflet 1.9.4 and 2.0.0-beta.4 (loaded from the CDN).
// Usage: npm install --no-save jsdom && npm run test:smoke
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const file = path.join(__dirname, 'smoke.html');

function stubs(w) {
	// jsdom has no layout engine; give Leaflet the few browser APIs it probes for.
	w.SVGSVGElement.prototype.createSVGRect = () => ({});
	w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
	w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
	w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}

async function run(version) {
	const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
		url: 'file://' + file + '?leaflet=' + version,
		runScripts: 'dangerously',
		resources: 'usable',
		pretendToBeVisual: true,
		beforeParse: stubs
	});
	for (let i = 0; i < 150 && !dom.window.__smoke; i++) { await new Promise((r) => setTimeout(r, 100)); }
	const s = dom.window.__smoke;
	dom.window.close();
	if (!s) { console.log(`Leaflet ${version}: timed out`); return false; }
	const passed = s.results.filter((r) => r.ok).length;
	console.log(`Leaflet ${s.version}: ${passed}/${s.results.length} checks passed`);
	s.results.filter((r) => !r.ok).forEach((r) => console.log('  FAIL ' + r.name + (r.info ? ' (' + r.info + ')' : '')));
	return s.pass;
}

(async () => {
	const ok = (await run(1)) & (await run(2));
	process.exit(ok ? 0 : 1);
})();
