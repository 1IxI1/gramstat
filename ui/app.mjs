import { CATALOGUE, periodDates } from './catalogue.mjs';
import { readObservedMetrics, latestChainRange } from './data.mjs';
import { TimeChart, buildRows, formatDate, formatSummary } from './charts.mjs';

const $ = (id) => document.getElementById(id);
const cards = new Map();
let readings;
let loading = true;
let requestId = 0;
let controller;
let coverage = [];

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

for (const definition of CATALOGUE) {
    const card = element('article', `chart-card ${definition.layout || ''}`);
    card.id = `chart-${definition.id}`;
    const heading = element('div', 'chart-heading');
    heading.append(element('h3', '', definition.title));
    const readout = element('div', 'readout');
    const value = element('span', 'readout-value', '—');
    const detail = element('span', 'readout-detail');
    readout.append(value, element('span', 'readout-unit', definition.unit), detail);
    const surface = element('div', 'chart-surface');
    const legend = element('div', 'chart-legend');
    const status = element('p', 'chart-status');
    card.append(heading, readout, surface, legend, status);
    $(`${definition.section}-charts`).append(card);
    const chart = new TimeChart(surface, { ...definition, series: [], loading }, [new Date().toISOString().slice(0, 10)]);
    cards.set(definition.id, { definition, value, detail, legend, status, chart });
}

function render() {
    if (!readings) return;
    for (const state of cards.values()) {
        const { definition } = state;
        const series = readings.metrics[definition.id]?.series || [];
        const dates = definition.round ? readings.roundDates : readings.dates;
        const shownDates = dates.length ? dates : readings.dates;
        const rows = buildRows(shownDates, series);
        const latest = rows.findLast((r) =>
            definition.kind.startsWith('stacked') ? r.total !== null : r.values.some(Number.isFinite),
        );
        const value = latest
            ? definition.kind.startsWith('stacked')
                ? latest.total
                : latest.values.find(Number.isFinite)
            : null;
        state.value.textContent = formatSummary(value, definition.unit);
        state.detail.textContent = latest ? formatDate(latest.date) : '';
        state.status.textContent =
            definition.unavailable ||
            (latest
                ? series.find((s) => s.details?.[latest.date])?.details[latest.date]
                : 'No covered observations in this interval.');
        state.legend.replaceChildren();
        if (series.length > 1)
            for (const s of series) {
                const item = element('span', 'legend-item');
                const swatch = element('span', 'swatch');
                swatch.style.backgroundColor = s.color;
                item.append(swatch, document.createTextNode(s.label));
                state.legend.append(item);
            }
        state.chart.update({ ...definition, series, loading }, shownDates);
    }
    const label = `${readings.period.from} — ${readings.dates.at(-1)} UTC`;
    $('period-status').textContent = label;
    document.querySelectorAll('[data-period-label]').forEach((n) => (n.textContent = label));
    $('source-status').textContent = coverage
        .map(
            (s) => `${s.source}: ${s.first_day ?? 'none'}–${s.last_day ?? 'none'} · updated ${s.updated_at ?? 'never'}`,
        )
        .join(' | ');
}

function warning(message) {
    $('warning').hidden = !message;
    $('warning-text').textContent = message;
}

async function getJSON(path, signal) {
    const r = await fetch(path, { signal, cache: 'no-cache' });
    if (!r.ok) throw new Error(`Request failed (${r.status}).`);
    return r.json();
}

function selection() {
    const from = $('from').value;
    const inclusive = $('to').value;
    const to = new Date(Date.parse(`${inclusive}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    periodDates(from, to);
    return { from, to };
}

async function load() {
    const id = ++requestId;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 25000);
    loading = true;
    $('apply').disabled = true;
    warning('');
    geoRequest++;
    $('geo-round').replaceChildren();
    $('geo-round').disabled = true;
    $('geo-locations').replaceChildren();
    // Do not retain another date range behind a failed reload.
    try {
        const range = selection();
        readings = readObservedMetrics({
            schemaVersion: 2,
            network: 'mainnet',
            period: range,
            chain: [],
            daily: [],
            stars: [],
            rounds: [],
        });
        render();
        const [data, sources] = await Promise.all([
            getJSON(`/api/v1/dashboard?${new URLSearchParams(range)}`, request.signal),
            getJSON('/api/v1/coverage', request.signal).catch(() => null),
        ]);
        if (id !== requestId) return;
        if (sources) coverage = sources.coverage;
        readings = readObservedMetrics(data);
        const params = new URLSearchParams(location.search);
        params.set('from', range.from);
        params.set('to', $('to').value);
        history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
        renderRounds();
    } catch (e) {
        if (id === requestId)
            warning(`Data could not be loaded. ${e.name === 'AbortError' ? 'Request timed out.' : e.message}`);
    } finally {
        clearTimeout(timeout);
        if (id === requestId) {
            loading = false;
            $('apply').disabled = false;
            render();
        }
    }
}

function renderRounds() {
    const list = $('geo-round');
    list.replaceChildren();
    for (const [date, r] of Object.entries(readings.roundDetails)) {
        const option = element('option', '', `${formatDate(date)} · ${r.located ?? '?'}/${r.total} located`);
        option.value = r.utime_since;
        list.append(option);
    }
    list.disabled = !list.options.length;
    $('geo-locations').replaceChildren();
    if (list.options.length) {
        list.selectedIndex = list.options.length - 1;
        loadLocations();
    }
}

let geoRequest = 0;
async function loadLocations() {
    const id = ++geoRequest;
    const round = $('geo-round').value;
    $('geo-locations').textContent = 'Loading locations…';
    try {
        const data = await getJSON(`/api/v1/locations?round=${encodeURIComponent(round)}`, AbortSignal.timeout(20000));
        if (id !== geoRequest) return;
        const snapshot = data.locations[0];
        $('geo-locations').replaceChildren();
        if (!snapshot) {
            $('geo-locations').textContent = 'No matching location snapshot.';
            return;
        }
        const clusters = new Map();
        for (const [country, city, latitude, longitude] of snapshot.points) {
            const key = JSON.stringify([country, city, latitude, longitude]);
            clusters.set(key, (clusters.get(key) || 0) + 1);
        }
        const caption = element(
            'p',
            '',
            `${snapshot.located}/${snapshot.total} located · ${snapshot.unknown} unknown · updated ${snapshot.calculated_at}`,
        );
        const table = element('table', 'locations-table');
        const head = element('tr');
        for (const title of ['Country', 'City', 'Coordinates', 'Validators']) head.append(element('th', '', title));
        table.append(head);
        for (const [key, count] of [...clusters].sort((a, b) => b[1] - a[1])) {
            const [country, city, lat, lon] = JSON.parse(key);
            const row = element('tr');
            for (const v of [country ?? 'Unknown', city ?? '—', `${lat}, ${lon}`, String(count)])
                row.append(element('td', '', v));
            table.append(row);
        }
        $('geo-locations').append(caption, table);
    } catch {
        if (id === geoRequest) $('geo-locations').textContent = 'Locations temporarily unavailable.';
    }
}

$('range-form').addEventListener('submit', (e) => {
    e.preventDefault();
    load();
});
$('retry').addEventListener('click', () => (readings ? load() : loadLatest()));
$('geo-round').addEventListener('change', loadLocations);
$('latest').addEventListener('click', loadLatest);
async function loadLatest() {
    const id = ++requestId;
    controller?.abort();
    loading = true;
    $('latest').disabled = $('apply').disabled = true;
    warning('');
    try {
        const sources = await getJSON('/api/v1/coverage', AbortSignal.timeout(20000));
        if (id !== requestId) return;
        coverage = sources.coverage;
        const range = latestChainRange(coverage);
        if (!range) throw new Error('No prepared chain history is available yet.');
        $('from').value = range.from;
        $('to').value = range.to;
        await load();
    } catch (e) {
        if (id === requestId) warning(`Data could not be loaded. ${e.message}`);
    } finally {
        $('latest').disabled = false;
        if (id === requestId) {
            loading = false;
            $('apply').disabled = false;
        }
    }
}
const params = new URLSearchParams(location.search);
$('to').max = $('from').max = new Date().toISOString().slice(0, 10);
if (params.has('from') && params.has('to')) {
    $('from').value = params.get('from');
    $('to').value = params.get('to');
    load();
} else loadLatest();
setInterval(
    () => {
        if (!loading && !document.hidden) readings ? load() : loadLatest();
    },
    5 * 60 * 1000,
);
