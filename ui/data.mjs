import { CATALOGUE, colorAt, periodDates } from './catalogue.mjs';
import { formatDate } from './charts.mjs';

// Exact strings remain in the response and tooltips. Conversion to Number is
// restricted to display coordinates; null and missing rows never become zero.
export function decimal(value, scale = 0) {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const digits = value.padStart(scale + 1, '0');
    return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}

// Mean of displayed UTC-day totals. Missing values never count as zero.
// Keep monetary arithmetic exact until rounding the displayed mean to 2 places.
export function dailyAverage(dates, series) {
    let sum = 0n;
    let count = 0;
    let partial = false;
    for (const date of dates) {
        const value = series?.exact?.[date];
        if (typeof value !== 'string' || !/^\d+(\.\d{1,9})?$/.test(value)) continue;
        const [whole, fraction = ''] = value.split('.');
        sum += BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
        count++;
        partial ||= Boolean(series.partial?.[date]);
    }
    if (!count) return { value: null, count, total: dates.length, partial: true };
    const denominator = BigInt(count) * 1000000000n;
    const cents = (sum * 100n + denominator / 2n) / denominator;
    const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return { value: `${whole}.${(cents % 100n).toString().padStart(2, '0')}`, count, total: dates.length, partial: partial || count !== dates.length };
}

export function rangeDurationLabel(from, to) {
    const seconds = (to - from) / 1000;
    for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
        if (seconds >= size) return `${Number((seconds / size).toFixed(2))}${unit}`;
    }
    return '0s';
}

// Inclusive date controls follow the indexed chain, rather than today's wall clock.
export function latestChainRange(coverage) {
    const chain = coverage.find((s) => s.source === 'chain');
    if (!chain?.first_day || !chain?.last_day) return null;
    const end = Date.parse(`${chain.last_day}T00:00:00Z`);
    const start = Date.parse(`${chain.first_day}T00:00:00Z`);
    if (!Number.isFinite(end) || !Number.isFinite(start) || start > end) return null;
    return { from: new Date(Math.max(start, end - 6 * 86400000)).toISOString().slice(0, 10), to: chain.last_day };
}

export function supplySeries(data) {
    if (data?.schemaVersion !== 2 || !Array.isArray(data.points)) throw new Error('Unsupported supply response.');
    const s = { id: 'total', label: 'Total supply', color: colorAt(0), ordered: true, points: [], exact: {}, details: {}, exactByIndex: [], detailsByIndex: [] };
    for (const p of data.points) {
        const date = new Date(p.utime * 1000).toISOString();
        const exact = decimal(p.supply_nanoton, 9);
        s.points.push([date, exact === null ? null : Number(exact)]);
        s.exact[date] = exact;
        s.details[date] = `MC ${p.mc_seqno} · ${data.intervalSeconds ? `interval ${data.intervalSeconds}s` : 'every MC'}`;
        s.exactByIndex.push(exact);
        s.detailsByIndex.push(s.details[date]);
    }
    return s;
}

export function inflationSeries(data) {
    if (data?.schemaVersion !== 2 || data.windowSeconds !== 86400 || !Array.isArray(data.points)) throw new Error('Unsupported inflation response.');
    const s = { id: 'total', label: 'Annual inflation', color: colorAt(0), points: [], exact: {}, details: {} };
    for (const p of data.points) {
        const date = new Date(p.utime * 1000).toISOString();
        const exact = typeof p.annualized_percent === 'string' && /^-?\d+(\.\d+)?$/.test(p.annualized_percent) ? p.annualized_percent : null;
        s.points.push([date, exact === null ? null : Number(exact)]);
        s.exact[date] = exact;
        s.details[date] = `24h window: ${formatDate(new Date(p.window_from * 1000).toISOString())} — ${formatDate(date)}. Minted: ${decimal(p.minted_24h_nanoton,9) ?? 'unknown'} GRAM. Burned: ${decimal(p.burned_24h_nanoton,9) ?? 'unknown'} GRAM. Supply: ${decimal(p.supply_nanoton,9) ?? 'unknown'} GRAM (MC ${p.supply_mc}).`;
    }
    return s;
}

export function accountsSeries(data) {
    if (data?.schemaVersion !== 2 || !Array.isArray(data.points)) throw new Error('Unsupported Accounts response.');
    const series = CATALOGUE.find((c) => c.id === 'accounts').series.map((s) => ({ ...s, ordered: true, points: [], exact: {}, details: {}, exactByIndex: [], detailsByIndex: [] }));
    for (const p of data.points) {
        const date = new Date(p.utime * 1000).toISOString();
        for (const s of series) {
            const exact = decimal(p[s.id]);
            const detail = `MC ${p.mc_seqno}`;
            s.points.push([date, exact === null ? null : Number(exact)]);
            s.exact[date] = exact; s.details[date] = detail;
            s.exactByIndex.push(exact); s.detailsByIndex.push(detail);
        }
    }
    return series;
}

export function readObservedMetrics(data) {
    if (data?.schemaVersion !== 2 || data.network !== 'mainnet' || !data.period)
        throw new Error('Unsupported API response.');
    const dates = periodDates(data.period.from, data.period.to);
    for (const key of ['chain', 'daily', 'stars', 'rounds'])
        if (!Array.isArray(data[key])) throw new Error('Incomplete API response.');
    const metrics = Object.fromEntries(
        CATALOGUE.map((c) => [c.id, { series: c.series.map((s) => ({ ...s, points: [], exact: {}, details: {} })) }]),
    );
    const dailyIDs = new Set(dates);
    const roundDates = [];
    const roundDetails = {};
    const put = (id, key, date, raw, scale, detail, partial = false) => {
        const item = metrics[id]?.series.find((s) => s.id === key);
        if (!item) return;
        const exact = decimal(raw, scale);
        const value = exact === null ? null : Number(exact);
        item.points.push([date, Number.isFinite(value) ? value : null]);
        item.exact[date] = exact;
        item.details[date] = detail;
        (item.partial ??= {})[date] = partial;
    };
    for (const r of data.chain) {
        if (!dailyIDs.has(r.day)) continue;
        const detail = r.is_partial ? 'Partial day.' : '';
        for (const [id, field, scale] of [
            ['supply', 'supply_nanoton', 9],
            ['fees', 'fees_nanoton', 9],
            ['minted', 'minted_nanoton', 9],
            ['burned', 'burned_nanoton', 9],
            ['transactions', 'transactions', 0],
        ]) {
            put(
                id,
                'total',
                r.day,
                r[field],
                scale,
                detail,
                Boolean(r.is_partial),
            );
        }
    }
    const dexes = [
        ...new Set(data.daily.filter((r) => r.metric === 'swaps_total').flatMap((r) => Object.keys(r.breakdown || {}))),
    ].sort();
    metrics.swaps_dex.series = dexes.map((id, i) => ({
        id,
        label: id,
        color: colorAt(i),
        points: [],
        exact: {},
        details: {},
    }));
    for (const r of data.daily) {
        if (!dailyIDs.has(r.day)) continue;
        const detail = r.is_partial ? 'Partial day.' : '';
        put(r.metric, 'total', r.day, r.value, 0, detail);
        for (const type of ['jetton', 'nft'])
            if ([`${type}_senders`, `${type}_receivers`].includes(r.metric))
                put(`${type}_users`, r.metric, r.day, r.value, 0, detail);
        if (r.metric.startsWith('liquid_staking_deposits_'))
            put('lst_amount', r.metric.slice('liquid_staking_deposits_'.length), r.day, r.amount_nanoton, 9, detail);
        if (r.metric === 'swaps_total')
            for (const dex of dexes) put('swaps_dex', dex, r.day, String(r.breakdown?.[dex] ?? '0'), 0, detail);
    }
    for (const r of data.stars) {
        if (!dailyIDs.has(r.day)) continue;
        const detail = `${r.is_partial ? 'Partial day. ' : ''}${r.unknown_purchases} purchases with unknown size.`;
        for (const [id, field] of [
            ['stars_quantity', 'stars_total'],
            ['stars_known', 'known_stars_total'],
            ['stars_unknown', 'unknown_purchases'],
        ])
            put(id, 'total', r.day, r[field], 0, detail);
    }
    let previousRoundUntil;
    for (const r of data.rounds) {
        if (previousRoundUntil != null && previousRoundUntil < r.utime_since) {
            const gap = new Date(previousRoundUntil * 1000).toISOString();
            roundDates.push(gap);
            for (const id of ['validator_count', 'countries', 'located']) put(id, 'total', gap, null);
        }
        const date = new Date(r.utime_since * 1000).toISOString();
        const until = new Date(r.utime_until * 1000).toISOString();
        roundDates.push(date);
        const detail = `Round until ${formatDate(until, { seconds: true })}. Count through ${formatDate(new Date(r.data_through * 1000).toISOString())}. Locations ${r.located ?? '?'}/${r.total}; ${r.geo_status ?? 'unavailable'}. Geo updated ${r.geo_calculated_at ? formatDate(r.geo_calculated_at) : 'never'}.`;
        roundDetails[date] = { ...r, detail };
        put('validator_count', 'total', date, String(r.total), 0, detail);
        put('countries', 'total', date, r.countries === null ? null : String(r.countries), 0, detail);
        put('located', 'total', date, r.located === null ? null : String(r.located), 0, detail);
        previousRoundUntil = r.utime_until;
    }
    return { metrics, dates, roundDates, roundDetails, period: data.period, servedAt: data.servedAt };
}
