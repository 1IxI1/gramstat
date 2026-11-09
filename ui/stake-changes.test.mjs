import test from 'node:test';
import assert from 'node:assert/strict';
import { readObservedMetrics } from './data.mjs';
import { buildRows, domain } from './charts.mjs';
import { CATALOGUE } from './catalogue.mjs';

test('stake-change stack totals exactly 100% and gaps stay unknown', () => {
    const r = { utime_since: 200000, utime_until: 265536, data_through: 200000, total: 10,
        stake_change_status: 'complete', stake_change_previous: 68928,
        stake_change_matched: 7, stake_change_current_holders: 8, stake_change_previous_holders: 9,
        stake_change_new: 1, stake_change_exited: 2,
        stake_change_near_reward: 3, stake_change_below_reward: 1, stake_change_above_reward: 1, stake_change_unchanged: 1, stake_change_decreased: 1 };
    const d = readObservedMetrics({ schemaVersion: 2, network: 'mainnet', period: { from: '1970-01-01', to: '1970-01-06' }, chain: [], daily: [], stars: [],
        rounds: [r, { ...r, utime_since: 265536, utime_until: 331072, stake_change_status: 'unknown_penalty_allocation' },
            { ...r, utime_since: 400000, utime_until: 465536, stake_change_near_reward: null }] });
    const ss = d.metrics.stake_changes.series, rows = buildRows(d.roundDates, ss);
    assert.deepEqual(rows.map(r => r.total), [100, null, null, null]);
    assert.equal(ss.reduce((sum, s) => sum + BigInt(s.exact[d.roundDates[0]].replace('.', '')), 0n), 1000000n);
    assert.match(ss[0].details[d.roundDates[0]], /Matched: 7 of 8 current addresses \(87.50%\)/);
    assert.match(ss[0].details[d.roundDates[0]], /New: 1\. Exited: 2\./);
    const config = CATALOGUE.find(c => c.id === 'stake_changes');
    assert.deepEqual(domain(config, rows), [0, 100]);
    // Hiding a category must not renormalize the remaining shares.
    assert.equal(buildRows(d.roundDates, ss.slice(1))[0].total, 57.1429);
});
