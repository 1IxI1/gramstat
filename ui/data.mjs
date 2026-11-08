import { CATALOGUE, colorAt, periodDates } from './catalogue.mjs';

// Exact strings remain in the response and tooltips. Conversion to Number is
// restricted to display coordinates; null and missing rows never become zero.
export function decimal(value, scale = 0) {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const digits = value.padStart(scale + 1, '0');
    return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
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
    const put = (id, key, date, raw, scale, detail) => {
        const item = metrics[id]?.series.find((s) => s.id === key);
        if (!item) return;
        const exact = decimal(raw, scale);
        const value = exact === null ? null : Number(exact);
        item.points.push([date, Number.isFinite(value) ? value : null]);
        item.exact[date] = exact;
        item.details[date] = detail;
    };
    for (const r of data.chain) {
        if (!dailyIDs.has(r.day)) continue;
        const detail = `${r.is_partial ? 'Partial boundary day. ' : ''}Indexed chain · ${r.source_id}. Prepared ${r.calculated_at}.`;
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
                id === 'supply' && r.supply_utime
                    ? `Snapshot ${new Date(r.supply_utime * 1000).toISOString()}. ${detail}`
                    : detail,
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
        const detail = `${r.is_partial ? 'Partial day. ' : ''}Indexed actions through ${r.data_through}. Calculated ${r.calculated_at}.`;
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
        const detail = `${r.is_partial ? 'Partial day. ' : ''}${r.unknown_purchases} purchases with unknown size. Through ${r.data_through}. Calculated ${r.calculated_at}.`;
        for (const [id, field] of [
            ['stars_quantity', 'stars_total'],
            ['stars_known', 'known_stars_total'],
            ['stars_unknown', 'unknown_purchases'],
        ])
            put(id, 'total', r.day, r[field], 0, detail);
    }
    for (const r of data.rounds) {
        const date = new Date(r.utime_since * 1000).toISOString();
        const until = new Date(r.utime_until * 1000).toISOString();
        roundDates.push(date);
        const detail = `Round until ${until}. Count through ${new Date(r.data_through * 1000).toISOString()}. Locations ${r.located ?? '?'}/${r.total}; ${r.geo_status ?? 'unavailable'}. Geo updated ${r.geo_calculated_at ?? 'never'}.`;
        roundDetails[date] = { ...r, detail };
        put('validator_count', 'total', date, String(r.total), 0, detail);
        put('countries', 'total', date, r.countries === null ? null : String(r.countries), 0, detail);
        put('located', 'total', date, r.located === null ? null : String(r.located), 0, detail);
    }
    return { metrics, dates, roundDates, roundDetails, period: data.period, servedAt: data.servedAt };
}
