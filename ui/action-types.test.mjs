import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_METRIC, ACTION_TYPES, ACTION_GROUPS, actionTypeReadings, totalActionSeries, excludedActionTypes } from './action-types.mjs';
import { monthlyActivity } from './data.mjs';
import { buildRows, exactStackTotal } from './charts.mjs';

const row = (day, breakdown, extra = {}) => ({ metric: ACTION_METRIC, day, breakdown,
    value: Object.values(breakdown).reduce((sum, value) => sum + BigInt(value), 0n).toString(), ...extra });

test('type filtering changes only its category and total; exact counts and missing days survive', () => {
    assert.equal(new Set(ACTION_TYPES).size, ACTION_TYPES.length);
    const dates = ['2026-11-10', '2026-11-11', '2026-11-12'];
    const raw = actionTypeReadings([row(dates[0], { ton_transfer: '9007199254740993', renew_dns: '7', change_dns: '3' }),
        row(dates[2], {}, { is_partial: 1 })], dates);
    const all = totalActionSeries(raw);
    const filtered = totalActionSeries(raw, new Set(['change_dns']));
    assert.equal(all.find(s => s.id === 'dns').exact[dates[0]], '10');
    assert.equal(filtered.find(s => s.id === 'dns').exact[dates[0]], '7');
    assert.deepEqual(filtered.find(s => s.id === 'gram'), all.find(s => s.id === 'gram'));
    assert.equal(filtered.at(-1).exact[dates[0]], '9007199254741000');
    for (const series of [all, filtered]) {
        const rows = buildRows(dates, series);
        assert.equal(rows[0].total, rows[0].values.at(-1));
        assert.equal(exactStackTotal(series, dates[0]), series.at(-1).exact[dates[0]]);
        assert.equal(rows[1].total, null);
        assert.equal(rows[2].total, 0);
        assert.equal(series.at(-1).partial[dates[2]], true);
    }
    const onlyRenew = totalActionSeries(raw, new Set(ACTION_TYPES.filter(t => t !== 'renew_dns')));
    assert.deepEqual(onlyRenew.map(s => s.id), ['dns', 'total']);
    assert.equal(onlyRenew.at(-1).exact[dates[0]], '7');
    assert.deepEqual(totalActionSeries(raw, new Set(ACTION_TYPES)), []);
    assert.deepEqual(excludedActionTypes(new URLSearchParams('excludeActions=renew_dns,unknown,renew_dns')), new Set(['renew_dns']));
});

test('inconsistent and unknown breakdowns are rejected rather than silently losing actions', () => {
    assert.throws(() => actionTypeReadings([row('2026-11-12', { ton_transfer: '3' }, { value: '4' })], []));
    assert.throws(() => actionTypeReadings([row('2026-11-12', { unknown_type: '3' })], []));
    assert.throws(() => actionTypeReadings([row('2026-11-12', { ton_transfer: '3' }, { breakdown: { ton_transfer: null } })], []));
});

test('monthly action selections sum exact types and retain incomplete-month provenance', () => {
    const data = { schemaVersion: 2, network: 'mainnet', period: { from: '2026-11-01', to: '2026-11-03' },
        chain: [], rounds: [], stars: [], daily: [row('2026-11-01', { renew_dns: '3', change_dns: '7' }), row('2026-11-02', { renew_dns: '4' }, { is_partial: 1 })] };
    const raw = monthlyActivity(data).metrics.actions_total.series;
    const series = totalActionSeries(raw, new Set(ACTION_TYPES.filter(t => t !== 'renew_dns')));
    assert.equal(series.at(-1).exact['2026-11-01'], '7');
    assert.equal(series.at(-1).partial['2026-11-01'], true);
    data.daily.pop();
    assert.equal(totalActionSeries(monthlyActivity(data).metrics.actions_total.series).at(-1).exact['2026-11-01'], null);
    assert.equal(ACTION_GROUPS.find(g => g.id === 'dns').types.length, 5);
});
