import assert from 'node:assert/strict';
import test from 'node:test';
import { CATALOGUE, periodDates } from './catalogue.mjs';
import { buildRows, formatDate, formatAxisDate, formatTooltipExact, domain } from './charts.mjs';
import { decimal, readObservedMetrics, latestChainRange, supplySeries, inflationSeries, dailyAverage, rangeDurationLabel } from './data.mjs';

const fixture = () => ({
    schemaVersion: 2,
    network: 'mainnet',
    period: { from: '2026-10-21', to: '2026-10-28' },
    chain: [
        {
            day: '2026-10-22',
            supply_nanoton: '5258373238061259412',
            fees_nanoton: null,
            transactions: '7',
            is_partial: 0,
        },
    ],
    daily: [{ day: '2026-10-22', metric: 'jetton_transfers', value: '0' }],
    stars: [{ day: '2026-10-22', stars_total: null, known_stars_total: '1234', unknown_purchases: '1' }],
    rounds: [
        {
            utime_since: 1792540800,
            utime_until: 1792606336,
            total: 380,
            countries: null,
            located: null,
            data_through: 1792606336,
        },
    ],
});

test('daily averages preserve exact amounts and distinguish zero, missing and partial days', () => {
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const series = { exact: { [dates[0]]: '9007199254740993.01', [dates[1]]: '0', [dates[2]]: null } };
    assert.deepEqual(dailyAverage(dates, series), { value: '4,503,599,627,370,496.51', count: 2, total: 3, partial: true });
    assert.equal(dailyAverage(dates, { exact: {} }).value, null);
    assert.deepEqual(dailyAverage([dates[0]], { exact: { [dates[0]]: '0' } }), { value: '0.00', count: 1, total: 1, partial: false });
    assert.equal(dailyAverage([dates[0]], { exact: { [dates[0]]: '10' }, partial: { [dates[0]]: true } }).partial, true);
    assert.equal(rangeDurationLabel(0, 7 * 86400000), '7d');
    assert.equal(rangeDurationLabel(0, 2 * 3600000), '2h');
    const f = fixture();
    f.chain[0].is_partial = 1;
    const data = readObservedMetrics(f);
    assert.equal(dailyAverage(data.dates, data.metrics.transactions.series[0]).partial, true);
});

test('no live chart uses generated data; unsupported metrics stay empty', () => {
    assert.ok(CATALOGUE.every((c) => c.series.every((s) => !s.demo)));
    const data = readObservedMetrics(fixture());
    for (const c of CATALOGUE.filter((c) => c.unavailable)) {
        assert.ok(data.metrics[c.id].series.every((s) => s.points.length === 0));
    }
    assert.equal(data.metrics.jetton_transfers.series[0].points[0][1], 0);
    assert.deepEqual(data.metrics.fees.series[0].points[0], ['2026-10-22', null]);
    const rows = buildRows(data.dates, data.metrics.supply.series);
    assert.equal(rows[0].values[0], null);
    assert.equal(rows[1].values[0], 5258373238.061259);
    assert.equal(data.metrics.supply.series[0].exact['2026-10-22'], '5258373238.061259412');
});

test('unknown totals and geo remain unknown, without falling back to subtotals', () => {
    const data = readObservedMetrics(fixture());
    assert.equal(data.metrics.stars_quantity.series[0].points[0][1], null);
    assert.equal(data.metrics.stars_known.series[0].points[0][1], 1234);
    assert.equal(data.metrics.countries.series[0].points[0][1], null);
    assert.equal(data.metrics.located.series[0].points[0][1], null);
    assert.equal(data.roundDates[0], '2026-10-21T00:00:00.000Z');
    assert.equal(CATALOGUE.find((c) => c.id === 'validator_count').kind, 'step');
});

test('zero-based chart axes leave headroom without doubling the peak', () => {
    const accounts = CATALOGUE.find((c) => c.id === 'accounts');
    const transactions = CATALOGUE.find((c) => c.id === 'transactions');
    assert.deepEqual(domain(accounts, [{ values: [0, 6_000_000, 98_040_000], total: 104_040_000 }]), [0, 120_000_000]);
    assert.deepEqual(domain(transactions, [{ values: [20_000_000], total: 20_000_000 }]), [0, 22_000_000]);
    assert.deepEqual(domain(transactions, [{ values: [1], total: 1 }]), [0, 1.1]);
    assert.deepEqual(domain(accounts, [{ values: [0, 0, 1], total: 1 }]), [0, 2]);
    assert.deepEqual(domain(transactions, [{ values: [0], total: 0 }]), [0, 1.1]);
    assert.deepEqual(domain(transactions, [{ values: [null], total: null }]), [0, 1]);
});

test('missing validator rounds remain gaps rather than carrying counts forward', () => {
    const f = fixture();
    f.rounds.push({ ...f.rounds[0], utime_since: 1792700000, utime_until: 1792760000, total: 400 });
    const data = readObservedMetrics(f);
    const rows = buildRows(data.roundDates, data.metrics.validator_count.series);
    assert.deepEqual(rows.map((r) => r.values[0]), [380, null, 400]);
    assert.equal(data.roundDates[1], new Date(f.rounds[0].utime_until * 1000).toISOString());
    assert.equal(Object.keys(data.roundDetails).length, 2);
});

test('date intervals cross months and years, with exclusive upper bounds', () => {
    assert.deepEqual(periodDates('2026-12-31', '2027-01-02'), ['2026-12-31', '2027-01-01']);
    assert.throws(() => periodDates('2026-02-30', '2026-03-04'));
    assert.equal(periodDates('2026-01-01', '2026-12-31').length, 364);
    assert.throws(() => periodDates('2019-01-01', '2030-01-01'));
    assert.match(formatDate('2026-11-07'), /Nov/);
    assert.equal(decimal(null, 9), null);
    assert.equal(decimal('0', 9), '0.000000000');
    assert.equal(decimal('1e9', 9), null);
    assert.throws(() => readObservedMetrics({ ...fixture(), schemaVersion: 1 }));
});

test('x-axis dates include years on long or year-crossing ranges', () => {
    const date = '2023-02-15T12:00:00Z';
    assert.equal(formatAxisDate(date, { span: 7 * 86400000, time: true }), '15 Feb');
    assert.equal(formatAxisDate(date, { span: 7 * 86400000, time: true, crossesYear: true }), '15 Feb 2023');
    assert.equal(formatAxisDate(date, { span: 90 * 86400000, time: true }), '15 Feb 2023');
    assert.equal(formatAxisDate(date, { span: 7 * 365 * 86400000, time: true }), '15 Feb 2023');
    assert.equal(formatAxisDate(date, { span: 3600000, time: true }), '12:00');
    assert.equal(formatAxisDate(date, { span: 300000, time: true }), '12:00:00');
});

test('tooltip groups whole digits and removes only insignificant fractional zeroes', () => {
    assert.equal(formatTooltipExact('49677279'), '49,677,279');
    assert.equal(formatTooltipExact('161758846'), '161,758,846');
    assert.equal(formatTooltipExact('577149.900000000'), '577,149.9');
    assert.equal(formatTooltipExact('100.000000000'), '100');
    assert.equal(formatTooltipExact('0.000000000'), '0');
    assert.equal(formatTooltipExact('0.000000001'), '0.000000001');
    assert.equal(formatTooltipExact('5258373238.061259412'), '5,258,373,238.061259412');
    assert.equal(formatTooltipExact('9007199254740993.01'), '9,007,199,254,740,993.01');
    assert.equal(formatTooltipExact('-0.120000000000'), '-0.12');
});

test('default range follows chain indexing rather than newer independent sources', () => {
    assert.deepEqual(latestChainRange([
        { source: 'actions', first_day: '2026-10-21', last_day: '2026-11-08' },
        { source: 'chain', first_day: '2019-11-15', last_day: '2024-01-03' },
    ]), { from: '2023-12-28', to: '2024-01-03' });
    assert.deepEqual(latestChainRange([{ source: 'chain', first_day: '2019-11-15', last_day: '2019-11-16' }]),
        { from: '2019-11-15', to: '2019-11-16' });
    assert.equal(latestChainRange([]), null);
    assert.equal(latestChainRange([{ source: 'chain', first_day: null, last_day: null }]), null);
});

test('per-MC supply retains distinct exact values within the same second', () => {
    const series = supplySeries({schemaVersion:2, intervalSeconds:0, points:[
        {utime:1793741108,mc_seqno:103190382,supply_nanoton:'5000000000000000001'},
        {utime:1793741108,mc_seqno:103190383,supply_nanoton:null},
    ]});
    const rows=buildRows(series.points.map((p)=>p[0]),[series]);
    assert.equal(rows.length,2);
    assert.equal(rows[0].values[0],5000000000);
    assert.equal(rows[1].values[0],null);
    assert.equal(series.exactByIndex[0],'5000000000.000000001');
    assert.match(series.detailsByIndex[0],/MC 103190382/);
    assert.match(series.detailsByIndex[1],/MC 103190383/);
});

test('burn-start annotations share the exact on-chain boundary', () => {
    for (const id of ['supply','burned','inflation']) {
        const [event] = CATALOGUE.find((c) => c.id === id).annotations;
        assert.equal(event.mc,30410593);
        assert.equal(new Date(event.utime*1000).toISOString(),'2023-06-17T06:33:26.000Z');
    }
});

test('annualized inflation preserves negative rates, exact inputs and unknown windows', () => {
    const series=inflationSeries({schemaVersion:2,windowSeconds:86400,points:[
        {utime:1792627200,window_from:1792540800,annualized_percent:'-0.123456789012',minted_24h_nanoton:'9007199254740993',burned_24h_nanoton:'9007199254741993',supply_nanoton:'5000000000000000001',supply_mc:123},
        {utime:1792630800,window_from:1792544400,annualized_percent:null,minted_24h_nanoton:null,burned_24h_nanoton:'1',supply_nanoton:null,supply_mc:124},
    ]});
    const rows=buildRows(series.points.map((p)=>p[0]),[series]);
    assert.equal(rows[0].values[0],-0.123456789012);
    assert.equal(rows[1].values[0],null);
    assert.match(series.details[rows[0].date],/9,007,199\.254740993 GRAM/);
    assert.match(series.details[rows[0].date],/5,000,000,000\.000000001 GRAM/);
    const [min,max]=domain(CATALOGUE.find((c)=>c.id==='inflation'),rows);
    assert.ok(min<rows[0].values[0] && max>rows[0].values[0]);
    assert.throws(()=>inflationSeries({schemaVersion:2,windowSeconds:3600,points:[]}));
});
