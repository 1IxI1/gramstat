import test from 'node:test';
import assert from 'node:assert/strict';
import { WALLET_REGISTRY_SHA256 } from './wallet-registry.mjs';
import { WALLET_VERSIONS, OTHER_WALLETS, activationSelection, writeActivationSelection, activationSeries, activationTotal } from './wallet-activations.mjs';
import { buildRows, exactStackTotal } from './charts.mjs';
import { dailyAverage } from './data.mjs';

const point = (utime, values, partial = false) => {
    const versions = Object.fromEntries(WALLET_VERSIONS.map(v => [v.id, values[v.id] || '0']));
    return { utime, value: Object.values(versions).reduce((s, v) => s+BigInt(v), 0n).toString(), versions, is_partial: partial };
};
const fixture = () => ({
    schemaVersion: 2, registry: WALLET_REGISTRY_SHA256, coverageDays: ['2026-11-12', '2026-11-14'],
    period: { from: '2026-11-12T00:00:00Z', to: '2026-11-15T00:00:00Z' },
    activations: { intervalSeconds: 86400, points: [
        point(1794441600, { wallet_tg: '9007199254740993', wallet_v3r2: '7', wallet_v5_beta: '3' }),
        point(1794614400, {}, true),
    ] },
});

test('two straight stack layers, exact selected totals, gaps and partial zeroes', () => {
    assert.equal(WALLET_VERSIONS.length, 18);
    assert.equal(OTHER_WALLETS.length, 17);
    const data = fixture(), selection = activationSelection(new URLSearchParams());
    const series = activationSeries(data, selection);
    assert.deepEqual(series.map(s => s.label), ['Tg-wallet', 'Others', 'Total']);
    const total = activationTotal(series), dates = total.points.map(p => p[0]);
    const rows = buildRows(dates, series);
    assert.equal(total.exact[dates[0]], '9007199254741003');
    assert.equal(total.points[0][1], rows[0].total);
    assert.equal(exactStackTotal(series, dates[0]), total.exact[dates[0]]);
    assert.equal(rows[1].total, null);
    assert.equal(rows.at(-1).total, 0);
    assert.equal(total.partial[dates.at(-1)], true);
    assert.equal(dailyAverage(dates,total).count, 2);
    selection.hidden.add('tg');
    selection.excluded = new Set(OTHER_WALLETS.filter(v => v.id !== 'wallet_v3r2').map(v => v.id));
    const single = activationSeries(data,selection);
    assert.deepEqual(single.map(s => s.label), ['Others (1/17)', 'Total']);
    assert.equal(single[0].exact[dates[0]], '7');
    assert.deepEqual(single[1], series[2]);
    assert.equal(dailyAverage(dates,activationTotal(single)).value, dailyAverage(dates,total).value);
    assert.equal(single[1].exact[dates[0]], '9007199254741003');
    assert.ok(single[1].points[0][1] > buildRows(dates,single)[0].total);
    selection.hidden.add('others');
    assert.deepEqual(activationSeries(data,selection), [series[2]]);
    selection.hidden.delete('others');
    selection.hidden.add('total');
    assert.deepEqual(activationSeries(data,selection).map(s => s.id), ['others']);
    assert.equal(dailyAverage(dates,activationTotal(activationSeries(data,selection))).value, '3.50');
    selection.hidden.add('others');
    assert.deepEqual(activationSeries(data,selection), []);
});

test('unknown breakdowns are gaps; malformed maps and mismatching totals fail', () => {
    const data = fixture(), selection = activationSelection(new URLSearchParams());
    data.activations.points[0].versions = null;
    assert.equal(activationSeries(data,selection)[0].points[0][1],null);
    assert.equal(activationSeries(data,selection).at(-1).exact['2026-11-12T00:00:00.000Z'],'9007199254741003');
    for (const mutate of [
        p => p.value = '1', p => delete p.versions.wallet_v3r2,
        p => p.versions.wallet_v3r2 = null, p => p.versions.unknown = '0',
    ]) {
        const data = fixture(); mutate(data.activations.points[0]);
        assert.throws(() => activationSeries(data,selection));
    }
});

test('URL preserves layer toggles independently of selected Others versions', () => {
    const q = new URLSearchParams('chart=activations&hideActivations=tg,unknown&excludeWallets=wallet_v3r2,unknown,wallet_v3r2');
    const selection = activationSelection(q);
    assert.deepEqual(selection.hidden,new Set(['tg']));
    assert.deepEqual(selection.excluded,new Set(['wallet_v3r2']));
    writeActivationSelection(q,selection);
    assert.equal(q.get('chart'),'activations');
    assert.equal(q.get('hideActivations'),'tg');
    assert.equal(q.get('excludeWallets'),'wallet_v3r2');
    selection.hidden.add('total'); writeActivationSelection(q,selection);
    assert.deepEqual(activationSelection(q).hidden,new Set(['tg','total']));
    selection.hidden.clear(); selection.excluded.clear(); writeActivationSelection(q,selection);
    assert.equal(q.toString(),'chart=activations');
});
