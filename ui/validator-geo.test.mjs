import test from 'node:test';
import assert from 'node:assert/strict';
import { validatorGeoSeries } from './data.mjs';

test('geography history uses the snapshot last second and keeps unknown counts distinct from zero', () => {
    const series = validatorGeoSeries([
        { utime_since: 100, utime_until: 200, geo_data_through: 200, located: 360, countries: 24, total: 361, geo_status: 'partial' },
        { utime_since: 200, utime_until: 300, geo_data_through: 250, located: 0, countries: null, total: 361, geo_status: 'missing_observations' },
        { utime_since: 300, utime_until: 400, geo_data_through: 401, located: 999, countries: 99 },
    ]);
    const points = s => s.points.map(([date, value]) => [Date.parse(date) / 1000, value]);
    assert.deepEqual(points(series[0]), [[199, 360], [249, 0], [300, null]]);
    assert.deepEqual(points(series[1]), [[199, 24], [249, null], [300, null]]);
    assert.equal(series[0].exact[series[0].points[0][0]], '360');
    assert.equal(series[0].partial[series[0].points[0][0]], true);
    assert.equal(series[1].axis, 'right');
});

test('geography history breaks lines across absent rounds and missing snapshots', () => {
    const [located, countries] = validatorGeoSeries([
        { utime_since: 100, utime_until: 200, geo_data_through: 200, located: 5, countries: 2, geo_status: 'complete' },
        { utime_since: 300, utime_until: 400, located: null, countries: null },
        { utime_since: 400, utime_until: 500, geo_data_through: 500, located: 7, countries: 3, geo_status: 'complete' },
    ]);
    assert.deepEqual(located.points.map(([date, value]) => [Date.parse(date) / 1000, value]), [[199, 5], [200, null], [300, null], [499, 7]]);
    assert.deepEqual(countries.points.map(([, value]) => value), [2, null, null, 3]);
});
