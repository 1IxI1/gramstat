import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTimeRange, indexedTime, resolveTimeRange, timeRangeFromURL, timeRangeLabel, writeTimeRange } from './time-ranges.mjs';

const ms = s => Date.parse(s);
const day = 86400000;
const now = ms('2026-11-11T14:00:00Z');
const coverage = (last = '2026-11-11T11:52:59Z', complete = '2026-11-10') => [
    { source: 'chain', first_day: '2019-11-15', last_day: '2026-11-11', last_complete_day: complete },
    { source: 'supply', first_utime: ms('2019-11-15T12:53:23Z') / 1000, last_utime: ms(last) / 1000 },
    { source: 'actions', last_day: '2026-11-12', updated_at: '2026-11-12T10:00:00Z' },
];
const relative = (seconds = 7 * 86400, completeDays = false) => ({ kind: 'relative', seconds, completeDays });

test('initial fixed range keeps 90 complete days while explicit Last ends at the indexed second', () => {
    const initial = defaultTimeRange(coverage(), now);
    assert.deepEqual(initial, { kind: 'absolute', from: ms('2026-08-13T00:00:00Z'), to: ms('2026-11-11T00:00:00Z'), completeDays: false });
    for (const seconds of [300, 3600, 86400, 7 * 86400, 90 * 86400]) {
        const range = resolveTimeRange(relative(seconds), coverage(), now);
        assert.equal(range.to - 1000, ms('2026-11-11T11:52:59Z'));
        assert.equal(range.to - range.from, seconds * 1000);
    }
    assert.equal(timeRangeLabel(relative(), resolveTimeRange(relative(), coverage(), now)), 'Last 7 days');
});

test('complete daily periods cut at a verified UTC midnight, never the month or a newer unverified day', () => {
    const choice = relative(7 * 86400, true);
    assert.deepEqual(resolveTimeRange(choice, coverage(), now), { from: ms('2026-11-04T00:00:00Z'), to: ms('2026-11-11T00:00:00Z') });
    assert.equal(resolveTimeRange(choice, coverage('2026-11-11T11:52:59Z', '2026-11-09'), now).to, ms('2026-11-10T00:00:00Z'));
    assert.equal(resolveTimeRange(choice, coverage('2026-11-10T23:59:59Z'), now).to, ms('2026-11-11T00:00:00Z'));
    assert.equal(resolveTimeRange(choice, coverage('2026-11-10T23:59:58Z'), now).to, ms('2026-11-10T00:00:00Z'));
    const absolute = { kind: 'absolute', from: ms('2026-11-01T00:00:00Z'), to: now + 1000, completeDays: false };
    assert.equal(resolveTimeRange({ ...absolute, completeDays: true }, coverage(), now).to, ms('2026-11-11T00:00:00Z'));
    assert.equal(resolveTimeRange(absolute, coverage(), now).to, now + 1000);
    assert.throws(() => resolveTimeRange({ ...absolute, from: ms('2026-11-11T01:00:00Z'), completeDays: true }, coverage(), now), /no time/);
});

test('relative URLs stay live across refresh and preserve independent wallet and action intervals', () => {
    const params = new URLSearchParams('from=2026-11-01&to=2026-11-10&activity=hourly&activityInterval=monthly&chart=supply');
    const choice = relative();
    writeTimeRange(params, choice);
    assert.equal(params.get('last'), '604800');
    assert.equal(params.has('from'), false);
    assert.equal(params.has('to'), false);
    assert.equal(params.get('activity'), 'hourly');
    assert.equal(params.get('activityInterval'), 'monthly');
    assert.equal(params.get('chart'), 'supply');
    assert.deepEqual(timeRangeFromURL(params), choice);
    const oldRange = resolveTimeRange(timeRangeFromURL(params), coverage(), now);
    const freshRange = resolveTimeRange(timeRangeFromURL(params), coverage('2026-11-11T12:52:59Z'), now);
    assert.equal(freshRange.from - oldRange.from, 3600000);
    assert.equal(freshRange.to - oldRange.to, 3600000);
    writeTimeRange(params, { ...choice, completeDays: true });
    assert.deepEqual(timeRangeFromURL(params), { ...choice, completeDays: true });
    const fixed = { kind: 'absolute', ...oldRange, completeDays: false };
    writeTimeRange(params, fixed);
    assert.deepEqual(timeRangeFromURL(params), fixed);
    assert.equal(params.has('last'), false);
    assert.equal(params.has('completeDays'), false);
    assert.equal(resolveTimeRange(timeRangeFromURL(params), coverage('2026-11-11T12:52:59Z'), now).to, oldRange.to);
});

test('missing exact coverage does not invent now; complete history remains selectable', () => {
    const daily = coverage().filter(s => s.source !== 'supply');
    assert.equal(indexedTime(daily), null);
    assert.throws(() => resolveTimeRange(relative(), daily, now), /indexed second/);
    assert.equal(resolveTimeRange(relative(86400, true), daily, now).to, ms('2026-11-11T00:00:00Z'));
    assert.throws(() => resolveTimeRange(relative(86400, true), [], now), /complete UTC day/);
    assert.throws(() => resolveTimeRange(relative(-1), coverage(), now), /relative interval/);
});

test('All time starts on the first available day, and legacy absolute URLs stay inclusive', () => {
    const choice = { kind: 'all', completeDays: false };
    const range = resolveTimeRange(choice, coverage(), now);
    assert.equal(range.from, ms('2019-11-15T00:00:00Z'));
    assert.equal(range.to, ms('2026-11-11T11:53:00Z'));
    const params = new URLSearchParams();
    writeTimeRange(params, choice);
    assert.deepEqual(timeRangeFromURL(params), choice);
    const fixed = timeRangeFromURL(new URLSearchParams('from=2026-11-10&to=2026-11-10'));
    assert.equal(fixed.to - fixed.from, day);
    assert.equal(fixed.to, ms('2026-11-11T00:00:00Z'));
});
