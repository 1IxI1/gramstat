import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyActivity, dailyAverage, readObservedMetrics } from './data.mjs';
import { periodDates } from './catalogue.mjs';

function fixture() {
    const period = { from: '2024-02-01', to: '2024-03-01' };
    const daily = periodDates(period.from, period.to).flatMap((day) => [
        { metric: 'jetton_transfers', day, value: '9007199254740993', is_partial: 0 },
        { metric: 'jetton_senders', day, value: '7', is_partial: 0 },
        { metric: 'liquid_staking_deposits_tonstakers', day, value: '1', amount_nanoton: '1000000001', is_partial: 0 },
    ]);
    daily.push({ metric: 'monthly_jetton_senders', day: '2024-02-01', value: '8', is_partial: 0 });
    return { schemaVersion: 2, network: 'mainnet', period, daily, chain: [], stars: [], rounds: [] };
}

test('monthly Activity preserves exact calendar sums and uses monthly distinct users', () => {
    const result = monthlyActivity(fixture());
    assert.deepEqual(result.dates, ['2024-02-01']);
    assert.equal(result.metrics.jetton_transfers.series[0].exact['2024-02-01'], String(29n * 9007199254740993n));
    assert.equal(result.metrics.jetton_users.series[0].exact['2024-02-01'], '8');
    assert.equal(result.metrics.jetton_users.series[1].exact['2024-02-01'], null);
    assert.equal(result.metrics.lst_amount, undefined);
    const dailyDeposits = readObservedMetrics(fixture()).metrics.lst_amount.series[0];
    assert.equal(dailyDeposits.exact['2024-02-01'], '1.000000001');
});

test('monthly Activity keeps missing days unknown and marks current partial months', () => {
    const data = fixture();
    data.daily = data.daily.filter((r) => !(r.metric === 'jetton_transfers' && r.day === '2024-02-14'));
    assert.equal(monthlyActivity(data).metrics.jetton_transfers.series[0].exact['2024-02-01'], null);
    data.period.to = '2024-02-10';
    const result = monthlyActivity(data);
    const series = result.metrics.jetton_transfers.series[0];
    assert.equal(series.exact['2024-02-01'], String(9n * 9007199254740993n));
    assert.equal(series.partial['2024-02-01'], true);
    assert.equal(dailyAverage(result.dates, series).partial, true);
});

test('daily Activity averages preserve partial-day provenance', () => {
    const data = fixture();
    data.daily[0].is_partial = 1;
    const result = readObservedMetrics(data);
    const avg = dailyAverage(result.dates, result.metrics.jetton_transfers.series[0]);
    assert.equal(avg.count, 29);
    assert.equal(avg.partial, true);
});

test('TVL reconciles known sides and uses the closing observation, never their sum', () => {
    const data = fixture();
    const make = (day, delta) => {
        const b = {};
        for (const v of ['stonfi','dedust']) {
            for (const k of ['full','partial','none','full_gram','full_nano','partial_gram','partial_nano','native_gram','native_nano'])
                b[`${v}:${k}`] = '0';
        }
        Object.assign(b, {'stonfi:full':'1','stonfi:full_gram':'9007199254740993','stonfi:full_nano':delta,
            'stonfi:native_gram':'99','dedust:partial':'1','dedust:partial_gram':'5','dedust:none':'3'});
        return {day,metric:'dex_tvl_gram_v1',value:'5',amount_nanoton:`9007199254740998${delta.padStart(9,'0')}`,is_partial:1,breakdown:b};
    };
    data.daily.push(make('2024-02-01','8'),make('2024-02-29','9'));
    const close=() => monthlyActivity(data).metrics.dex_tvl.series[0];
    assert.equal(close().exact['2024-02-01'],'9007199254740993.000000009');
    assert.match(close().details['2024-02-01'],/2024-02-29/);
    data.daily.at(-1).amount_nanoton='0';
    assert.equal(close().exact['2024-02-01'],null);
    data.daily.pop();
    assert.equal(close().exact['2024-02-01'],null); // No silent carry across a missing close.
});

test('DEX volume reconciles the exact priced stack and keeps missing histories unknown', () => {
    const data = fixture();
    const row = { metric:'dex_volume_gram_v1', day:'2024-02-01', value:'2', amount_nanoton:'100000000000000000002',
        is_partial:1, breakdown:{'gram:stonfi':'100000000000','nano:stonfi':'1','priced:stonfi':'1',
            'nano:multiple':'1','priced:multiple':'1','unpriced:dedust':'2',ambiguous:'3'} };
    data.daily.push(row);
    const get = () => readObservedMetrics(data).metrics.dex_volume.series;
    let s = get();
    assert.equal(s.find(x => x.id === 'stonfi').exact[row.day], '100000000000.000000001');
    assert.equal(s.find(x => x.id === 'multiple').exact[row.day], '0.000000001');
    assert.match(s[0].details[row.day], /2 priced routes; 2 without a price; 3 unresolved/);
    assert.equal(monthlyActivity(data).metrics.dex_volume.series[0].exact[row.day], null);
    row.amount_nanoton = '1';
    assert.ok(get().every(x => x.exact[row.day] === null));
    row.value='0'; row.amount_nanoton=null; row.breakdown={ambiguous:'1'};
    assert.ok(get().every(x => x.exact[row.day] === null));
    row.amount_nanoton='0'; row.breakdown={ambiguous:'0'}; row.is_partial=0;
    assert.ok(get().every(x => x.exact[row.day] === '0.000000000'));
});

test('Stars purchased retains known quantities in daily and monthly views despite unknown sizes', () => {
    const data = fixture();
    data.stars = periodDates(data.period.from, data.period.to).map((day, i) => ({
        day, stars_total: i === 0 ? null : '0', known_stars_total: i === 0 ? '9007199254740993' : '0',
        unknown_purchases: i === 0 ? '2' : '0', is_partial: 0,
    }));
    const daily = readObservedMetrics(data).metrics.stars_quantity.series[0];
    assert.equal(daily.exact['2024-02-01'], '9007199254740993');
    assert.equal(daily.exact['2024-02-02'], '0');
    assert.equal(daily.details['2024-02-01'], '');
    assert.equal(daily.partial['2024-02-01'], false);
    const monthly = monthlyActivity(data).metrics.stars_quantity.series[0];
    assert.equal(monthly.exact['2024-02-01'], '9007199254740993');
    assert.equal(monthly.partial['2024-02-01'], false);
    assert.equal(monthly.details['2024-02-01'], '');
    assert.equal(dailyAverage(['2024-02-01'], monthly).partial, false);
    data.stars[0].is_partial = 1;
    assert.equal(readObservedMetrics(data).metrics.stars_quantity.series[0].partial['2024-02-01'], true);
    const partialMonth = monthlyActivity(data).metrics.stars_quantity.series[0];
    assert.equal(partialMonth.partial['2024-02-01'], true);
    assert.equal(partialMonth.details['2024-02-01'], 'Partial calendar month.');
    data.stars[0].is_partial = 0;
    assert.equal(data.stars[0].stars_total, null);
    data.stars.pop();
    assert.equal(monthlyActivity(data).metrics.stars_quantity.series[0].exact['2024-02-01'], null);
});
test('jetton transfer splits preserve master gaps, independent totals and exact monthly sums', () => {
    const days=['2024-02-01','2024-02-02'];
    const data={schemaVersion:2, network:'mainnet', period:{from:days[0],to:'2024-02-03'}, chain:[],rounds:[],stars:[],
        daily:days.flatMap(day=>[{day,metric:'jetton_transfers',value:'13'},
            {day,metric:'jetton_transfer_assets_v1',value:'13',breakdown:{usdt:'8',others:'3',unknown:'2'}}])};
    const series=()=>Object.fromEntries(monthlyActivity(data).metrics.jetton_transfers.series.map(s=>[s.id,s.exact[days[0]]]));
    assert.deepEqual(series(), {total:'26',usdt:'16',others:'6',unknown:'4'});
    data.daily.pop();
    assert.deepEqual(series(), {total:'26',usdt:null,others:null,unknown:null});
    data.daily[1].breakdown.usdt='0';
    assert.throws(series,/Invalid jetton_transfer_assets/);
});
