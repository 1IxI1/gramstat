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
    assert.equal(result.metrics.lst_amount.series[0].exact['2024-02-01'], '29.000000029');
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

test('Stars purchased retains known quantities in daily and monthly views despite unknown sizes', () => {
    const data = fixture();
    data.stars = periodDates(data.period.from, data.period.to).map((day, i) => ({
        day, stars_total: i === 0 ? null : '0', known_stars_total: i === 0 ? '9007199254740993' : '0',
        unknown_purchases: i === 0 ? '2' : '0', is_partial: 0,
    }));
    for (const id of ['stars_quantity', 'stars_known']) {
        const daily = readObservedMetrics(data).metrics[id].series[0];
        assert.equal(daily.exact['2024-02-01'], '9007199254740993');
        assert.equal(daily.exact['2024-02-02'], '0');
        assert.equal(daily.details['2024-02-01'], '');
        assert.equal(daily.partial['2024-02-01'], false);
        const monthly = monthlyActivity(data).metrics[id].series[0];
        assert.equal(monthly.exact['2024-02-01'], '9007199254740993');
        assert.equal(monthly.partial['2024-02-01'], false);
        assert.equal(monthly.details['2024-02-01'], '');
        assert.equal(dailyAverage(['2024-02-01'], monthly).partial, false);
        data.stars[0].is_partial = 1;
        assert.equal(readObservedMetrics(data).metrics[id].series[0].partial['2024-02-01'], true);
        const partialMonth = monthlyActivity(data).metrics[id].series[0];
        assert.equal(partialMonth.partial['2024-02-01'], true);
        assert.equal(partialMonth.details['2024-02-01'], 'Partial calendar month.');
        data.stars[0].is_partial = 0;
    }
    assert.equal(data.stars[0].stars_total, null);
    data.stars.pop();
    assert.equal(monthlyActivity(data).metrics.stars_quantity.series[0].exact['2024-02-01'], null);
});
