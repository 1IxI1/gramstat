import test from 'node:test';
import assert from 'node:assert/strict';
import { readObservedMetrics } from './data.mjs';
import { buildRows, domain, exactStackTotal, formatTooltipExact } from './charts.mjs';
import { CATALOGUE, stakePoolSeries } from './catalogue.mjs';

const definition = CATALOGUE.find(c => c.id === 'stake_locked');
function fixture() {
    const r = { utime_since: 200000, utime_until: 265536, data_through: 265536, total: 364,
        selected_nanogram: '646028071866458480', locked_previous: 134464, locked_previous_selected_nanogram: '647506520151916796',
        locked_total_nanogram: '1293534592018375276', locked_telegram_nanogram: '217254026640880000',
        locked_pools_nanogram: '297491676296108533', locked_others_nanogram: '778788889081386743',
        locked_pool_breakdown: { 'Whales-like': '117619488977401504', 'Tonstakers-like': '171065375589688854', 'Hipo-like': '8806811729018175' }, locked_status: 'partial_attribution',
        locked_positions: 724, locked_typed_positions: 724, locked_isp_observed_positions: 720, locked_is_partial: 0 };
    return { schemaVersion: 2, network: 'mainnet', period: { from: '1970-01-01', to: '1970-01-07' },
        chain: [], daily: [], stars: [], rounds: [r,
            { ...r, utime_since: 265536, utime_until: 331072, locked_status: 'missing_attribution', locked_telegram_nanogram: null, locked_pools_nanogram: null, locked_others_nanogram: null },
            { ...r, utime_since: 400000, utime_until: 465536, locked_total_nanogram: null, locked_status: null }] };
}

test('locked stake preserves a known total independently of protocol layers', () => {
    const d = readObservedMetrics(fixture()), ss = d.metrics.stake_locked.series;
    const rows = buildRows(d.roundDates, ss), total = ss.find(s => s.overlay);
    assert.equal(CATALOGUE.some(c => ['telegram_share', 'liquid_staking_share'].includes(c.id)), false);
    assert.ok(Math.abs(rows[0].total - total.points[0][1]) < 0.000001); // Plot coordinates only; exact money is checked below.
    assert.equal(exactStackTotal(ss, d.roundDates[0], 0), '1293534592.018375276');
    assert.equal(formatTooltipExact(total.exact[d.roundDates[0]]), '1,293,534,592.018375276');
    assert.equal(rows[1].total, null);
    assert.equal(total.exact[d.roundDates[1]], '1293534592.018375276');
    assert.equal(exactStackTotal(ss, d.roundDates[1], 1), null);
    assert.equal(rows[2].total, null); // Gap between actual round intervals.
    assert.equal(total.exact[d.roundDates[2]], null);
    assert.equal(total.exact[d.roundDates[3]], null);
    assert.match(total.details[d.roundDates[0]], /Liquid Staking total: 297,491,676.296108533 GRAM/);
    assert.match(total.details[d.roundDates[1]], /total is independently known/);
    assert.equal(total.partial[d.roundDates[0]], false);
    assert.equal(ss[0].partial[d.roundDates[0]], true);
    assert.ok(domain({ ...definition, series: ss }, [rows[1]])[1] > total.points[1][1]);
    assert.equal(buildRows(d.roundDates, [total])[0].total, null);
    const whales = ss.find(s => s.poolLabel === 'Whales-like');
    assert.equal(whales.exact[d.roundDates[0]], '117619488.977401504');
    assert.equal(buildRows(d.roundDates, [whales])[0].total, whales.points[0][1]);
    assert.equal(ss.some(s => s.id === 'pools'), false);
});

test('locked stake rejects inconsistent splits and retains real zero categories', () => {
    const f = fixture();
    f.rounds[0].locked_telegram_nanogram = '0';
    let d = readObservedMetrics(f), ss = d.metrics.stake_locked.series;
    assert.equal(ss[0].exact[d.roundDates[0]], null);
    assert.equal(ss.find(s => s.overlay).exact[d.roundDates[0]], '1293534592.018375276');
    f.rounds[0].locked_others_nanogram = '996042915722266743';
    d = readObservedMetrics(f); ss = d.metrics.stake_locked.series;
    assert.equal(ss[0].exact[d.roundDates[0]], '0.000000000');
    assert.equal(exactStackTotal(ss, d.roundDates[0], 0), '1293534592.018375276');
});

test('confirmed and unconfirmed affiliations remain separate, with known absence distinct from missing data', () => {
    const f = fixture(), r = f.rounds[0];
    f.rounds = [
        { ...r, locked_pool_breakdown: { ...r.locked_pool_breakdown, Tonstakers: '70979251248198222', 'Tonstakers-like': '100086124341490632' } },
        { ...r, utime_since: 265536, utime_until: 331072 },
        { ...r, utime_since: 331072, utime_until: 396608, locked_status: 'missing_attribution' },
    ];
    const d = readObservedMetrics(f), ss = d.metrics.stake_locked.series;
    const official = ss.find(s => s.label === 'Tonstakers'), like = ss.find(s => s.label === 'Tonstakers-like');
    assert.notEqual(official.id, like.id);
    assert.notEqual(official.color, like.color);
    assert.deepEqual(official.points.map(p => p[1]), [70979251.248198222, 0, null]);
    assert.deepEqual(like.points.map(p => p[1]), [100086124.341490632, 171065375.589688854, null]);
    assert.equal(exactStackTotal(ss, d.roundDates[0], 0), '1293534592.018375276');
    assert.equal(exactStackTotal(ss, d.roundDates[1], 1), '1293534592.018375276');
    const visible = ss.filter(s => s !== official);
    assert.equal(exactStackTotal(visible, d.roundDates[0], 0), '1222555340.770177054');
    assert.equal(ss.find(s => s.overlay).exact[d.roundDates[0]], '1293534592.018375276');
    // Date-range changes and input ordering cannot change a protocol's color/ID.
    assert.deepEqual(stakePoolSeries(['Tonstakers-like']), stakePoolSeries(['Bemo', 'Tonstakers-like']).filter(s => s.label === 'Tonstakers-like'));
});

test('unreconciled protocol breakdowns do not silently lose stake or turn into zero', () => {
    for (const breakdown of [undefined, null, {}, { 'Whales-like': '117619488977401504' }, { Hipo: -1 }, { Hipo: '1.5' }]) {
        const f = fixture(); f.rounds = [{ ...f.rounds[0], locked_pool_breakdown: breakdown }];
        const d = readObservedMetrics(f), ss = d.metrics.stake_locked.series;
        assert.ok(ss.filter(s => !s.overlay).every(s => s.exact[d.roundDates[0]] === null));
        assert.equal(ss.find(s => s.overlay).exact[d.roundDates[0]], '1293534592.018375276');
    }
    const f = fixture(); f.rounds = [{ ...f.rounds[0], locked_pools_nanogram: '0', locked_others_nanogram: '1076280565377495276', locked_pool_breakdown: {} }];
    const d = readObservedMetrics(f);
    assert.equal(exactStackTotal(d.metrics.stake_locked.series, d.roundDates[0], 0), '1293534592.018375276');
    assert.equal(d.metrics.stake_locked.series.some(s => s.poolLabel), false);
});
