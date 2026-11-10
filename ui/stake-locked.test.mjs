import test from 'node:test';
import assert from 'node:assert/strict';
import { readObservedMetrics } from './data.mjs';
import { buildRows, domain, exactStackTotal, formatTooltipExact } from './charts.mjs';
import { CATALOGUE } from './catalogue.mjs';

const definition = CATALOGUE.find(c => c.id === 'stake_locked');
function fixture() {
    const r = { utime_since: 200000, utime_until: 265536, data_through: 265536, total: 364,
        selected_nanogram: '646028071866458480', locked_previous: 134464, locked_previous_selected_nanogram: '647506520151916796',
        locked_total_nanogram: '1293534592018375276', locked_telegram_nanogram: '217254026640880000',
        locked_pools_nanogram: '297491676296108533', locked_others_nanogram: '778788889081386743',
        locked_pool_breakdown: { 'Whales-like': '117619488977401504' }, locked_status: 'partial_attribution',
        locked_positions: 724, locked_typed_positions: 724, locked_isp_observed_positions: 720, locked_is_partial: 0 };
    return { schemaVersion: 2, network: 'mainnet', period: { from: '1970-01-01', to: '1970-01-07' },
        chain: [], daily: [], stars: [], rounds: [r,
            { ...r, utime_since: 265536, utime_until: 331072, locked_status: 'missing_attribution', locked_telegram_nanogram: null, locked_pools_nanogram: null, locked_others_nanogram: null },
            { ...r, utime_since: 400000, utime_until: 465536, locked_total_nanogram: null, locked_status: null }] };
}

test('locked stake preserves a known total independently of three stacked categories', () => {
    const d = readObservedMetrics(fixture()), ss = d.metrics.stake_locked.series;
    const rows = buildRows(d.roundDates, ss), total = ss.find(s => s.overlay);
    assert.equal(CATALOGUE.some(c => ['telegram_share', 'liquid_staking_share'].includes(c.id)), false);
    assert.equal(rows[0].total, total.points[0][1]); // Never double count the overlay.
    assert.equal(exactStackTotal(ss, d.roundDates[0], 0), '1293534592.018375276');
    assert.equal(formatTooltipExact(total.exact[d.roundDates[0]]), '1,293,534,592.018375276');
    assert.equal(rows[1].total, null);
    assert.equal(total.exact[d.roundDates[1]], '1293534592.018375276');
    assert.equal(exactStackTotal(ss, d.roundDates[1], 1), null);
    assert.equal(rows[2].total, null); // Gap between actual round intervals.
    assert.equal(total.exact[d.roundDates[2]], null);
    assert.equal(total.exact[d.roundDates[3]], null);
    assert.match(total.details[d.roundDates[0]], /Whales-like: 117,619,488.977401504 GRAM/);
    assert.match(total.details[d.roundDates[1]], /total is independently known/);
    assert.equal(total.partial[d.roundDates[0]], false);
    assert.equal(ss[0].partial[d.roundDates[0]], true);
    assert.ok(domain({ ...definition, series: ss }, [rows[1]])[1] > total.points[1][1]);
    assert.equal(buildRows(d.roundDates, [total])[0].total, null);
    assert.equal(buildRows(d.roundDates, ss.filter(s => s.id === 'pools'))[0].total, ss[1].points[0][1]);
});

test('locked stake rejects inconsistent splits and retains real zero categories', () => {
    const f = fixture();
    f.rounds[0].locked_telegram_nanogram = '0';
    let d = readObservedMetrics(f), ss = d.metrics.stake_locked.series;
    assert.equal(ss[0].exact[d.roundDates[0]], null);
    assert.equal(ss[3].exact[d.roundDates[0]], '1293534592.018375276');
    f.rounds[0].locked_others_nanogram = '996042915722266743';
    d = readObservedMetrics(f); ss = d.metrics.stake_locked.series;
    assert.equal(ss[0].exact[d.roundDates[0]], '0.000000000');
    assert.equal(exactStackTotal(ss, d.roundDates[0], 0), '1293534592.018375276');
});
