import { CATALOGUE, colorAt, periodDates } from './catalogue.mjs';
import { formatDate, formatTooltipExact } from './charts.mjs';
import { WALLET_REGISTRY_SHA256 } from './wallet-registry.mjs';

// Exact strings remain in the response and tooltips. Conversion to Number is
// restricted to display coordinates; null and missing rows never become zero.
export function decimal(value, scale = 0) {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const digits = value.padStart(scale + 1, '0');
    return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}

// Mean of displayed UTC-day totals. Missing values never count as zero.
// Keep monetary arithmetic exact until rounding the displayed mean to 2 places.
export function dailyAverage(dates, series, aggregate) {
    let sum = 0n;
    let count = 0;
    let partial = false;
    let total = dates.length;
    for (const date of aggregate ? [] : dates) {
        const value = series?.exact?.[date];
        if (typeof value !== 'string' || !/^\d+(\.\d{1,9})?$/.test(value)) continue;
        const [whole, fraction = ''] = value.split('.');
        sum += BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
        count++;
        partial ||= Boolean(series.partial?.[date]);
    }
    if (aggregate) {
        sum = BigInt(aggregate.sum) * 1000000000n;
        count = aggregate.count;
        total = aggregate.total;
    }
    if (!count) return { value: null, count, total, partial: true };
    const denominator = BigInt(count) * 1000000000n;
    const cents = (sum * 100n + denominator / 2n) / denominator;
    const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return { value: `${whole}.${(cents % 100n).toString().padStart(2, '0')}`, count, total, partial: partial || count !== total };
}

export function walletPeriodLabel(date, id, mode = 'daily') {
    if (id === 'activated_wallets') return `as of ${formatDate(date, { seconds: true })} UTC`;
    const start = new Date(date);
    if (id === 'active_wallets_daily' && mode === 'monthly') {
        return `for ${new Intl.DateTimeFormat('en-GB', { month:'short', year:'numeric', timeZone:'UTC' }).format(start)} · UTC month`;
    }
    if (id === 'active_wallets_daily' && mode === 'hourly') {
        return `for ${formatDate(date)} – ${formatDate(new Date(start.getTime()+3600000).toISOString())} UTC`;
    }
    return `for ${new Intl.DateTimeFormat('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' }).format(start)} · UTC day`;
}

export function observationPeriodLabel(date, definition, mode, round) {
    if (definition.section === 'wallet') return walletPeriodLabel(date, definition.id, mode);
    if (definition.section === 'activity' && mode === 'monthly') return walletPeriodLabel(date, 'active_wallets_daily', mode);
    if (['supply','accounts'].includes(definition.id)) return `as of ${formatDate(date,{seconds:true})} UTC`;
    if (definition.id === 'inflation') return `24h ending ${formatDate(date)} UTC`;
    if (definition.round) return round
        ? `round ${formatDate(date,{seconds:true})} – ${formatDate(new Date(round.utime_until*1000).toISOString(),{seconds:true})} UTC`
        : `round starting ${formatDate(date,{seconds:true})} UTC`;
    return walletPeriodLabel(date, 'activations');
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
        const amount = (value) => value === null ? 'unknown' : formatTooltipExact(decimal(value, 9) ?? 'unknown');
        s.details[date] = `24h window: ${formatDate(new Date(p.window_from * 1000).toISOString())} — ${formatDate(date)}. Minted: ${amount(p.minted_24h_nanoton)} GRAM. Burned: ${amount(p.burned_24h_nanoton)} GRAM. Supply: ${amount(p.supply_nanoton)} GRAM (MC ${p.supply_mc}).`;
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

export function walletSeries(data, id) {
    if (data?.schemaVersion !== 2 || data.registry !== WALLET_REGISTRY_SHA256 || !Array.isArray(data.coverageDays)) throw new Error('Unsupported wallet response.');
    const key = { activated_wallets: 'activated', activations: 'activations', active_wallets_daily: 'active' }[id];
    const dataset = data[key];
    if (!Array.isArray(dataset?.points)) throw new Error('Incomplete wallet response.');
    const definition = CATALOGUE.find((c) => c.id === id);
    const s = { ...definition.series[0], ordered: true, points: [], exact: {}, details: {}, exactByIndex: [], detailsByIndex: [] };
    const rows = [...dataset.points];
    const fromDate = new Date(data.period.from);
    const monthly = dataset.calendarMonths === true;
    const start = monthly ? Date.UTC(fromDate.getUTCFullYear(),fromDate.getUTCMonth(),1)/1000 : Math.floor(Date.parse(data.period.from) / 86400000) * 86400;
    const end = Date.parse(data.period.to) / 1000;
    const covered = new Set(dataset.coverageDays || data.coverageDays);
    for (let t = start; t < end;) {
        const date = new Date(t*1000);
        const next = monthly ? Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)/1000 : t+86400;
        if (!covered.has(new Date(t * 1000).toISOString().slice(0, 10))) {
            rows.push({ utime: t, value: null });
            if (!monthly) rows.push({ utime: Math.min(t + 86399, end - 1), value: null });
        }
        t=next;
    }
    rows.sort((a, b) => a.utime - b.utime || (a.mc_seqno ?? 0) - (b.mc_seqno ?? 0));
    for (const p of rows) {
        const date = new Date(p.utime * 1000).toISOString();
        const exact = decimal(p.value);
        const detail = exact === null ? 'No covered observations.' : key === 'activated'
            ? `MC ${p.mc_seqno} · ${dataset.intervalSeconds ? `interval ${dataset.intervalSeconds}s` : 'every MC'}`
            : `${formatDate(date)} — ${formatDate(new Date((p.end_utime ?? p.utime + dataset.intervalSeconds) * 1000).toISOString())} UTC (end exclusive)${monthly ? ' · calendar-month unique wallets' : ''}`;
        s.points.push([date, exact === null ? null : Number(exact)]);
        s.exact[date] = exact; s.details[date] = detail;
        s.exactByIndex.push(exact); s.detailsByIndex.push(detail);
    }
    return s;
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
        const exact = scale === 'percent'
            ? (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? raw : null)
            : decimal(raw, scale);
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
        put(r.metric, 'total', r.day, r.value, 0, detail, Boolean(r.is_partial));
        for (const type of ['jetton', 'nft'])
            if ([`${type}_senders`, `${type}_receivers`].includes(r.metric))
                put(`${type}_users`, r.metric, r.day, r.value, 0, detail, Boolean(r.is_partial));
        if (r.metric.startsWith('liquid_staking_deposits_'))
            put('lst_amount', r.metric.slice('liquid_staking_deposits_'.length), r.day, r.amount_nanoton, 9, detail, Boolean(r.is_partial));
        if (r.metric === 'swaps_total')
            for (const dex of dexes) put('swaps_dex', dex, r.day, String(r.breakdown?.[dex] ?? '0'), 0, detail, Boolean(r.is_partial));
    }
    for (const r of data.stars) {
        if (!dailyIDs.has(r.day)) continue;
        const detail = `${r.is_partial ? 'Partial day. ' : ''}${r.unknown_purchases} purchases with unknown size.`;
        for (const [id, field] of [
            ['stars_quantity', 'known_stars_total'],
            ['stars_known', 'known_stars_total'],
            ['stars_unknown', 'unknown_purchases'],
        ])
            put(id, 'total', r.day, r[field], 0,
                id === 'stars_quantity' ? `Known quantities only; purchases with unknown size are excluded. ${detail}` : detail,
                Boolean(r.is_partial) || (id === 'stars_quantity' && r.stars_total == null));
    }
    let previousRoundUntil;
    for (const r of data.rounds) {
        if (previousRoundUntil != null && previousRoundUntil < r.utime_since) {
            const gap = new Date(previousRoundUntil * 1000).toISOString();
            roundDates.push(gap);
            for (const id of ['validator_count', 'countries', 'located', 'staking_apr']) put(id, 'total', gap, null);
            for (const key of ['submitted', 'selected', 'remaining', 'reward']) put('stake', key, gap, null);
        }
        const date = new Date(r.utime_since * 1000).toISOString();
        const until = new Date(r.utime_until * 1000).toISOString();
        roundDates.push(date);
        const detail = `Round until ${formatDate(until, { seconds: true })}. Count through ${formatDate(new Date(r.data_through * 1000).toISOString())}. Locations ${r.located ?? '?'}/${r.total}; ${r.geo_status ?? 'unavailable'}. Geo updated ${r.geo_calculated_at ? formatDate(r.geo_calculated_at) : 'never'}.`;
        roundDetails[date] = { ...r, detail };
        put('validator_count', 'total', date, String(r.total), 0, detail);
        put('countries', 'total', date, r.countries === null ? null : String(r.countries), 0, detail);
        put('located', 'total', date, r.located === null ? null : String(r.located), 0, detail);
        const stakeDetail = r.unfreeze_utime == null ? 'Final principal has not been collected.' : `Principal before release on ${formatDate(new Date(r.unfreeze_utime * 1000).toISOString(), { seconds: true })} UTC; rewards excluded.`;
        for (const key of ['submitted', 'selected', 'remaining', 'reward']) {
            put('stake', key, date, r[`${key}_nanogram`], 9,
                key === 'reward' ? 'Accumulated election reward before distribution; principal excluded.' : key === 'remaining' ? stakeDetail : `Election ${r.election_id ?? 'unknown'}; ${key === 'submitted' ? 'accepted applications before selection' : 'maximum observed selected principal'}.`);
        }
        const aprDetail = r.apr_percent == null ? `APR unavailable: ${(r.apr_status || 'missing inputs').replaceAll('_', ' ')}.`
            : `Rewards: ${decimal(r.reward_nanogram, 9)} GRAM.\nSelected stake: ${decimal(r.selected_nanogram, 9)} GRAM.\nAPR = (Rewards / Selected stake) × (31,536,000 s / ${r.apr_cycle_seconds} s) × 100%.`;
        put('staking_apr', 'total', date, r.apr_percent, 'percent', aprDetail);
        previousRoundUntil = r.utime_until;
    }
    return { metrics, dates, roundDates, roundDetails, period: data.period, servedAt: data.servedAt };
}

// Restore the existing adapter contract from shared-axis columns. There is no
// numerical conversion here: exact strings, zeros and unknowns remain distinct.
export function expandActivityColumns(data) {
    const dates = data?.dates;
    if (!Array.isArray(dates) || !data.period || !Array.isArray(data.metrics)) throw Error('Invalid Activity columns.');
    const column = (values) => {
        if (!Array.isArray(values) || values.length !== dates.length) throw Error('Invalid Activity column length.');
        return values;
    };
    const daily = [];
    for (const metric of data.metrics) {
        const values = column(metric.values), amounts = column(metric.amounts), partial = column(metric.partial);
        for (const values of Object.values(metric.breakdown || {})) column(values);
        for (let i = 0; i < dates.length; i++) {
            if (values[i] === null) continue;
            daily.push({ metric: metric.metric, day: dates[i], value: values[i], amount_nanoton: amounts[i], is_partial: partial[i],
                breakdown: Object.fromEntries(Object.entries(metric.breakdown || {}).map(([key, values]) => [key, values[i]])) });
        }
    }
    const { total, known, unknown, partial } = data.stars;
    [total, known, unknown, partial].forEach(column);
    const stars = dates.flatMap((day, i) => known[i] === null ? [] : [{ day, stars_total: total[i], known_stars_total: known[i], unknown_purchases: unknown[i], is_partial: partial[i] }]);
    return { schemaVersion: 2, network: 'mainnet', period: data.period, chain: [], daily, stars, rounds: [] };
}

// Calendar-month sums use exact strings. Unique addresses come only from the
// independently prepared monthly observations, never the sum of daily uniques.
export function monthlyActivity(data) {
    const daily = readObservedMetrics(data);
    const months = [...new Set(daily.dates.map((d) => `${d.slice(0, 7)}-01`))];
    const unique = new Map(data.daily.filter((r) => r.metric.startsWith('monthly_')).map((r) => [`${r.metric}/${r.day}`, r]));
    const metrics = {};
    for (const definition of CATALOGUE.filter((c) => c.section === 'activity')) {
        metrics[definition.id] = { series: daily.metrics[definition.id].series.map((source) => {
            const series = { ...source, points: [], exact: {}, details: {}, partial: {} };
            for (const month of months) {
                const start = new Date(`${month}T00:00:00Z`);
                const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
                const days = periodDates(month, end).filter((d) => d < data.period.to);
                const uniqueName = ['jetton_users', 'nft_users'].includes(definition.id) ? source.id : definition.id === 'swaps_users' ? 'swaps_users' : null;
                let exact = null;
                let partial = end > data.period.to;
                if (uniqueName) {
                    const row = unique.get(`monthly_${uniqueName}/${month}`);
                    exact = decimal(row?.value);
                    partial ||= Boolean(row?.is_partial);
                } else if (days.length && days.every((d) => source.exact[d] != null)) {
                    const scale = definition.unit === 'GRAM' ? 9 : 0;
                    const sum = days.reduce((total, day) => {
                        const [whole, fraction = ''] = source.exact[day].split('.');
                        return total + BigInt(whole + fraction.padEnd(scale, '0'));
                    }, 0n);
                    exact = decimal(String(sum), scale);
                    partial ||= days.some((d) => source.partial?.[d]);
                }
                series.exact[month] = exact;
                series.points.push([month, exact === null ? null : Number(exact)]);
                series.partial[month] = partial;
                series.details[month] = exact === null ? 'Monthly history is being prepared.' : partial ? 'Partial calendar month.' : '';
                if (definition.id === 'stars_quantity' && exact !== null) {
                    const counts = days.map((day) => daily.metrics.stars_unknown.series[0].exact[day]);
                    const unknown = counts.every((v) => typeof v === 'string' && /^\d+$/.test(v))
                        ? formatTooltipExact(String(counts.reduce((sum, v) => sum + BigInt(v), 0n))) : 'an unknown number of';
                    series.details[month] = `${end > data.period.to ? 'Partial calendar month. ' : ''}Known quantities only; ${unknown} purchases with unknown size excluded.`;
                }
            }
            return series;
        }) };
    }
    return { ...daily, metrics, dates: months };
}
