import test from 'node:test';
import assert from 'node:assert/strict';
import { readObservedMetrics } from './data.mjs';
import { domain } from './charts.mjs';

test('Stake keeps three exact stages on one round axis and gaps in missing history', () => {
    const rounds = [
        { utime_since: 100, utime_until: 200, data_through: 200, total: 5, submitted_nanogram: '900719925474099312345', selected_nanogram: '800719925474099312345', remaining_nanogram: null },
        { utime_since: 300, utime_until: 400, data_through: 400, total: 5, submitted_nanogram: '1000000000', selected_nanogram: '1000000000', remaining_nanogram: '0', reward_nanogram: '900719925474099312345', unfreeze_utime: 500 },
    ];
    const data = readObservedMetrics({ schemaVersion: 2, network: 'mainnet', period: { from: '1970-01-01', to: '1970-01-02' }, chain: [], daily: [], stars: [], rounds });
    const series = data.metrics.stake.series;
    assert.deepEqual(series.map(s => s.id), ['submitted', 'selected', 'remaining', 'reward']);
    assert.equal(series[3].axis, 'right');
    assert.equal(series[3].exact[data.roundDates[0]], null);
    assert.equal(series[3].exact[data.roundDates[2]], '900719925474.099312345');
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

test('Reward never changes the primary stake scale', () => {
    const config = { kind: 'step', series: [{}, { axis: 'right' }] };
    assert.deepEqual(domain(config, [{ values: [100, 1] }, { values: [200, 1e12] }]),
        domain({ kind: 'step' }, [{ values: [100] }, { values: [200] }]));
});

test('APR preserves decimal percentages, two-round proof, zero and missing observations', () => {
    const round = { utime_since: 100, utime_until: 65636, data_through: 65636, total: 5,
        selected_nanogram: '900719925474099312345', reward_nanogram: '123456789012345',
        apr_percent: '12.123456789012', apr_cycle_seconds: 131072, apr_status: 'complete' };
    const rounds = [round,
        { ...round, utime_since: 65636, utime_until: 131172, apr_percent: '0.000000000000', reward_nanogram: '0' },
        { ...round, utime_since: 200000, utime_until: 265536, apr_percent: null, apr_status: 'missing_reward' }];
    const data = readObservedMetrics({ schemaVersion: 2, network: 'mainnet', period: { from: '1970-01-01', to: '1970-01-05' }, chain: [], daily: [], stars: [], rounds });
    const s = data.metrics.staking_apr.series[0];
    assert.deepEqual(s.points.map(p => p[1]), [12.123456789012, 0, null, null]);
    assert.deepEqual(s.points.map(p => p[0]), data.roundDates);
    assert.equal(s.exact[data.roundDates[0]], '12.123456789012');
    assert.match(s.details[data.roundDates[0]], /900719925474\.099312345 GRAM/);
    assert.match(s.details[data.roundDates[0]], /18 h, 12 min, 16 s/);
    assert.match(s.details[data.roundDates[0]], /36 h, 24 min, 32 s/);
    assert.match(s.details[data.roundDates[3]], /missing reward/);
});
