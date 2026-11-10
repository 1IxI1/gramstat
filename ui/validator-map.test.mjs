import test from 'node:test';
import assert from 'node:assert/strict';
import { locationClusters, projectLocation } from './validator-map.mjs';

test('map keeps real coordinates and groups collocated validators across place labels', () => {
    const clusters = locationClusters([
        ['NL', 'Amsterdam', 52.37, 4.89], ['NL', null, 52.37, 4.89],
        ['US', 'New York', 40.71, -74.01], [null, null, 0, 15],
        ['XX', null, null, null], ['XX', null, 0, 0], ['XX', null, 91, 10], ['XX', null, 20, Infinity],
    ]);
    assert.equal(clusters.length, 3);
    assert.equal(clusters.reduce((sum, cluster) => sum + cluster.count, 0), 4);
    assert.equal(clusters[0].count, 2);
    assert.equal(clusters[0].places.size, 2);
    assert.deepEqual([clusters[0].latitude, clusters[0].longitude], [52.37, 4.89]);
    assert.equal(projectLocation('52', 4), null);
});

test('map projection preserves hemispheres, zero longitude and antimeridian edges', () => {
    assert.deepEqual(projectLocation(90, -180), [20, 10]);
    assert.deepEqual(projectLocation(-90, 180), [980, 490]);
    assert.deepEqual(projectLocation(45, 0), [500, 130]);
    const [londonX, londonY] = projectLocation(51.5, -0.1);
    const [sydneyX, sydneyY] = projectLocation(-33.9, 151.2);
    assert(londonX < 500 && londonY < 250);
    assert(sydneyX > 500 && sydneyY > 250);
});
