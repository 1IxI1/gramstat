import assert from 'node:assert/strict';
import test from 'node:test';
import { walletSeries, dailyAverage, observationPeriodLabel } from './data.mjs';
import { buildRows } from './charts.mjs';
import { WALLET_REGISTRY_SHA256 } from './wallet-registry.mjs';

test('activity mean uses every hour rather than sampled plot points', () => {
    const mean = dailyAverage(['sample'], {exact:{sample:'7'}}, {sum:'10',count:2,total:3});
    assert.equal(mean.value, '5.00');
    assert.equal(mean.count, 2);
    assert.equal(mean.partial, true);
    assert.equal(dailyAverage([], {}, {sum:'10',count:2,total:2,partial:true}).partial, true);
});

test('current wallet hours retain partial zeroes and their certified end independently of closed-day coverage', () => {
    const data = { schemaVersion:2, registry:WALLET_REGISTRY_SHA256,
        period:{from:'2026-11-12T00:00:00Z',to:'2026-11-12T01:30:00Z'},coverageDays:[],
        active:{mode:'hourly',intervalSeconds:3600,coverageDays:['2026-11-12'],points:[
            {utime:1794441600,value:'42',end_utime:1794445200,is_partial:false},
            {utime:1794445200,value:'0',end_utime:1794447000,is_partial:true},
        ]} };
    const series=walletSeries(data,'active_wallets_daily');
    assert.deepEqual(series.points.map(p=>p[1]),[42,0]);
    assert.equal(series.partial[series.points[1][0]],true);
    assert.match(series.detailsByIndex[1],/01:30:00 UTC.*partial/);
    assert.equal(dailyAverage(series.points.map(p=>p[0]),series).partial,true);
});

test('observation captions distinguish days, hours, months, instants and round bounds', () => {
    const date='2026-07-15T23:00:00Z';
    assert.equal(observationPeriodLabel(date,{id:'activations',section:'wallet'}),'for 15 Jul 2026 · UTC day');
    assert.match(observationPeriodLabel(date,{id:'active_wallets_daily',section:'wallet'},'hourly'),/15 Jul 2026 23:00.*16 Jul 2026 00:00 UTC/);
    assert.equal(observationPeriodLabel(date,{id:'active_wallets_daily',section:'wallet'},'monthly'),'for Jul 2026 · UTC month');
    assert.match(observationPeriodLabel(date,{id:'supply'}),/^as of .*23:00:00 UTC$/);
    assert.match(observationPeriodLabel(date,{id:'inflation'}),/^24h ending /);
    assert.match(observationPeriodLabel(date,{id:'fees'}),/UTC day$/);
    assert.match(observationPeriodLabel(date,{round:true},null,{utime_until:Date.parse('2026-07-16T23:00:00Z')/1000}),/^round .*15 Jul.*16 Jul.*UTC$/);
});

test('wallet adapter preserves MC ties, exact zero, and missing-day gaps', () => {
    const data = { schemaVersion: 2, registry: WALLET_REGISTRY_SHA256, period: { from: '2024-10-13T00:00:00Z', to: '2024-10-15T00:00:00Z' }, coverageDays: ['2024-10-13'],
        activated: { intervalSeconds: 0, points: [{ utime: 1728777601, mc_seqno: 10, value: '4' }, { utime: 1728777601, mc_seqno: 11, value: '5' }] },
        active: { intervalSeconds: 60, points: [{ utime: 1728777600, value: '0' }] } };
    const series = walletSeries(data, 'activated_wallets');
    const rows = buildRows(series.points.map(p => p[0]), [series]);
    assert.deepEqual(rows.slice(0, 2).map(r => r.values[0]), [4, 5]);
    assert.match(series.detailsByIndex[1], /MC 11/);
    assert.equal(rows.at(-1).values[0], null);
    const active = walletSeries(data, 'active_wallets_daily');
    assert.equal(active.exactByIndex[0], '0');
    assert.equal(active.exactByIndex.at(-1), null);
    assert.throws(() => walletSeries({ ...data, registry: 'different' }, 'activated_wallets'));
});

test('live cumulative and daily activations have their own coverage and retain MC ties', () => {
    const data={schemaVersion:2,registry:WALLET_REGISTRY_SHA256,coverageDays:[],
        period:{from:'2026-11-12T00:00:00Z',to:'2026-11-12T01:00:00Z'},
        activated:{intervalSeconds:0,coverageDays:['2026-11-12'],points:[
            {utime:1794441660,mc_seqno:11,value:'9007199254740994'},
            {utime:1794441660,mc_seqno:12,value:'9007199254740995'}]},
        activations:{intervalSeconds:86400,coverageDays:['2026-11-12'],points:[{utime:1794441600,value:'2',end_utime:1794441900,is_partial:true}]}};
    const cumulative=walletSeries(data,'activated_wallets');
    assert.deepEqual(cumulative.exactByIndex,['9007199254740994','9007199254740995']);
    assert.match(cumulative.detailsByIndex[1],/MC 12/);
    const daily=walletSeries(data,'activations');
    assert.equal(daily.points.length,1);
    assert.equal(daily.partial[daily.points[0][0]],true);
});

test('monthly activity has one point per calendar month and preserves missing months', () => {
    const data = { schemaVersion: 2, registry: WALLET_REGISTRY_SHA256,
        period: { from: '2024-09-13T00:00:00Z', to: '2024-11-01T00:00:00Z' },
        coverageDays: ['2024-10-13', '2024-10-14'],
        active: { mode: 'monthly', calendarMonths: true, intervalSeconds: 0, windowSeconds: 0,
            coverageDays: ['2024-10-01'], points: [{utime: 1727740800, end_utime: 1730419200, value: '7'}] } };
    const series = walletSeries(data, 'active_wallets_daily');
    assert.equal(series.points[0][1], null);
    assert.equal(series.points.at(-1)[1], 7);
    assert.equal(series.points.length, 2);
    assert.match(series.detailsByIndex.at(-1), /calendar-month unique wallets/);
    assert.match(series.detailsByIndex.at(-1), /Nov|11/);
});
