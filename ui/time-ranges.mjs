const DAY = 86400000;
const minimum = Date.parse('2019-01-01T00:00:00Z');
export const RANGE_PRESETS = [
    ['5 minutes', 300], ['1 hour', 3600], ['24 hours', 86400],
    ['7 days', 7 * 86400], ['30 days', 30 * 86400], ['90 days', 90 * 86400],
    ['180 days', 180 * 86400], ['1 year', 365 * 86400], ['2 years', 730 * 86400],
];
export const inputTime = (ms) => new Date(ms).toISOString().slice(0, 19);
export const displayTime = (ms) => inputTime(ms).replace('T', ' ');

// The UI end is inclusive; API intervals are exclusive. Never infer a live
// second from a daily row, publication time, or the browser's wall clock.
export function indexedTime(coverage) {
    const supply = coverage.find(s => s.source === 'supply');
    return Number.isSafeInteger(supply?.last_utime) && supply.last_utime > 0 ? supply.last_utime * 1000 : null;
}

function completeEnd(coverage) {
    const day = coverage.find(s => s.source === 'chain')?.last_complete_day;
    if (!day) throw new Error('No confirmed complete UTC day is available yet.');
    const end = Date.parse(`${day}T00:00:00Z`) + DAY;
    const latest = indexedTime(coverage);
    return latest === null ? end : Math.min(end, Math.floor((latest + 1000) / DAY) * DAY);
}

export function resolveTimeRange(choice, coverage, now = Date.now()) {
    const chain = coverage.find(s => s.source === 'chain');
    const supply = coverage.find(s => s.source === 'supply');
    let from = choice.from, to = choice.to;
    if (choice.kind !== 'absolute') {
        const latest = indexedTime(coverage);
        if (!choice.completeDays && latest === null) throw new Error('The latest indexed second is not available yet.');
        to = choice.completeDays ? completeEnd(coverage) : latest + 1000;
        const first = Number.isSafeInteger(supply?.first_utime) && supply.first_utime > 0
            ? supply.first_utime * 1000 : Date.parse(`${chain?.first_day}T00:00:00Z`);
        if (choice.kind === 'all') {
            const firstDay = Date.parse(`${chain?.first_day}T00:00:00Z`);
            from = Number.isFinite(firstDay) ? Math.min(first, firstDay) : first;
        } else {
            if (!RANGE_PRESETS.some(([, seconds]) => seconds === choice.seconds)) throw new Error('Choose a valid relative interval.');
            from = Math.max(first, to - choice.seconds * 1000);
        }
    } else if (choice.completeDays) to = Math.min(to, completeEnd(coverage));
    from = Math.max(minimum, Math.floor(from / 1000) * 1000);
    to = Math.min(Math.floor(now / DAY) * DAY + DAY, Math.ceil(to / 1000) * 1000);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
        throw new Error(choice.completeDays ? 'This range contains no time before the last complete UTC day ends.' : 'Choose a valid UTC interval.');
    }
    return { from, to };
}

export function defaultTimeRange(coverage, now = Date.now()) {
    const range = resolveTimeRange({ kind: 'relative', seconds: 90 * 86400, completeDays: true }, coverage, now);
    // Keep the initial, fixed 90-day view. Explicit Last presets opt into now.
    return { kind: 'absolute', ...range, completeDays: false };
}

export function timeRangeLabel(choice, range) {
    if (choice.kind === 'relative') return `Last ${RANGE_PRESETS.find(([, seconds]) => seconds === choice.seconds)[0]}`;
    if (choice.kind === 'all') return 'All time';
    return `${displayTime(range.from)} — ${displayTime(range.to - 1000)}`;
}

export function timeRangeFromURL(params) {
    const completeDays = params.get('completeDays') === '1';
    const seconds = Number(params.get('last'));
    if (RANGE_PRESETS.some(([, value]) => value === seconds)) return { kind: 'relative', seconds, completeDays };
    if (params.get('range') === 'all') return { kind: 'all', completeDays };
    const from = params.get('from'), to = params.get('to');
    if (!from || !to) return null;
    return { kind: 'absolute',
        from: Date.parse(`${from.length === 10 ? `${from}T00:00:00` : from}Z`),
        to: Date.parse(`${to.length === 10 ? `${to}T23:59:59` : to}Z`) + 1000,
        completeDays };
}

export function writeTimeRange(params, choice) {
    for (const key of ['from', 'to', 'last', 'range', 'completeDays']) params.delete(key);
    if (choice.kind === 'relative') params.set('last', choice.seconds);
    else if (choice.kind === 'all') params.set('range', 'all');
    else {
        params.set('from', inputTime(choice.from));
        params.set('to', inputTime(choice.to - 1000));
    }
    if (choice.completeDays) params.set('completeDays', '1');
}
