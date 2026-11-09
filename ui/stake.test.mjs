import test from 'node:test';
import assert from 'node:assert/strict';
import { readObservedMetrics } from './data.mjs';

test('Stake keeps three exact stages on one round axis and gaps in missing history', () => {
    const rounds = [
        { utime_since: 100, utime_until: 200, data_through: 200, total: 5, submitted_nanogram: '900719925474099312345', selected_nanogram: '800719925474099312345', remaining_nanogram: null },
        { utime_since: 300, utime_until: 400, data_through: 400, total: 5, submitted_nanogram: '1000000000', selected_nanogram: '1000000000', remaining_nanogram: '0', unfreeze_utime: 500 },
    ];
    const data = readObservedMetrics({ schemaVersion: 2, network: 'mainnet', period: { from: '1970-01-01', to: '1970-01-02' }, chain: [], daily: [], stars: [], rounds });
    const series = data.metrics.validator_stake.series;
    assert.deepEqual(series.map(s => s.id), ['submitted', 'selected', 'remaining']);
    assert.equal(series[0].exact[data.roundDates[0]], '900719925474.099312345');
    assert.equal(series[1].exact[data.roundDates[0]], '800719925474.099312345');
    assert.equal(series[2].exact[data.roundDates[0]], null);
    assert.equal(series[2].exact[data.roundDates[2]], '0.000000000');
    for (const s of series) {
        assert.deepEqual(s.points.map(p => p[0]), data.roundDates);
        assert.equal(s.points[1][1], null);
    }
    assert.match(series[2].details[data.roundDates[2]], /rewards excluded/);
});
