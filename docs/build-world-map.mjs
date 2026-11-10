// Run with pinned d3-geo@3.1.1 and topojson-client@3.1.0; see world-map.md.
import { readFile, writeFile } from 'node:fs/promises';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const world = JSON.parse(await readFile(process.argv[2], 'utf8'));
// Must match projectLocation in ui/validator-map.mjs.
const projection = geoEquirectangular().scale(960 / (2 * Math.PI)).translate([500, 250]);
const path = geoPath(projection).digits(1);
await writeFile(process.argv[3], `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500">
<!-- Natural Earth 1:110m via world-atlas 2.0.2; public domain. See docs/world-map.md. -->
<defs>
<path id="land" d="${path(feature(world, world.objects.land))}"/>
<path id="borders" d="${path(mesh(world, world.objects.countries, (a, b) => a !== b))}"/>
</defs>
</svg>
`);
