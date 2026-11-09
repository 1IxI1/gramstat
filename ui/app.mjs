import { CATALOGUE } from './catalogue.mjs';
import { readObservedMetrics, latestChainRange, supplySeries, inflationSeries, accountsSeries, walletSeries, dailyAverage, rangeDurationLabel } from './data.mjs';
import { TimeChart, buildRows, formatDate, formatSummary } from './charts.mjs';
import { createWalletRegistry } from './wallet-registry.mjs';

const $ = (id) => document.getElementById(id);
const cards = new Map();
let readings;
let loading = true;
const pendingCharts = new Set();
let requestId = 0;
let controller;
let coverage = [];
let supplyData;
let supplyError = '';
let inflationData;
let inflationError = '';
let accountsData;
let accountsError = '';
let walletsData;
let walletsError = '';
const activityModes = ['hourly', 'daily', 'monthly'];
const activityFromURL = () => activityModes.includes(new URLSearchParams(location.search).get('activity')) ? new URLSearchParams(location.search).get('activity') : 'daily';
let activityMode = activityFromURL();
const activityTabs = [];
let activityRequest = 0;
let activityController;
let activityLoading = false;
let activityError = '';
let rangeLoad = Promise.resolve();

function selectActivity(mode) {
    if (mode === activityMode) return;
    activityMode = mode;
    const url = new URL(location.href);
    url.searchParams.set('activity', mode);
    history.pushState(null, '', url);
    loadActivity();
}

async function loadActivity() {
    const id = ++activityRequest;
    activityController?.abort();
    activityLoading = true;
    activityError = '';
    render('wallets', false, 'active_wallets_daily');
    // A range load already owns up to four reader slots. Wait for it without
    // restarting it, then fetch only the newly selected wallet view.
    await rangeLoad;
    if (id !== activityRequest || !activeRange) return;
    const request = new AbortController();
    activityController = request;
    const timeout = setTimeout(() => request.abort(), 25000);
    const mode = activityMode;
    const params = new URLSearchParams({
        from: new Date(activeRange.from).toISOString().replace('.000Z', 'Z'),
        to: new Date(activeRange.to).toISOString().replace('.000Z', 'Z'),
        activity: mode,
        maxPoints: String(Math.max(100, Math.min(1200, Math.round(cards.get('active_wallets_daily').chart.surface.clientWidth)))),
    });
    try {
        const data = await getJSON(`/api/v1/wallets?${params}`, request.signal);
        if (id !== activityRequest) return;
        // Retain the other wallet charts and their publication snapshot.
        walletsData = walletsData ? { ...walletsData, active: data.active } : data;
    } catch (e) {
        if (id === activityRequest) activityError = `Active wallets unavailable: ${e.message}`;
    } finally {
        clearTimeout(timeout);
        if (id === activityRequest) {
            activityLoading = false;
            render('wallets', false, 'active_wallets_daily');
        }
    }
}

function syncActivityTabs() {
    for (const tab of activityTabs) {
        const selected = tab.dataset.mode === activityMode;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
    const surface = cards.get('active_wallets_daily')?.chart.surface;
    surface?.setAttribute('aria-labelledby', `activity-${activityMode}`);
}
let validatorsError = '';
let activeRange;
let wideRange = false;
const recentRanges = [];
const inputTime = (ms) => new Date(ms).toISOString().slice(0, 19);
const displayTime = (ms) => inputTime(ms).replace('T', ' ');
let calendarMonth;
let calendarStart = null;

function drawCalendar() {
    if (!calendarMonth) return;
    $('calendar-month').textContent = new Intl.DateTimeFormat('en-GB', {month:'long',year:'numeric',timeZone:'UTC'}).format(calendarMonth);
    const first = Date.UTC(calendarMonth.getUTCFullYear(), calendarMonth.getUTCMonth(), 1);
    const offset = (new Date(first).getUTCDay() + 6) % 7;
    const start = Date.parse(`${$('from').value.slice(0,10)}T00:00:00Z`);
    const end = Date.parse(`${$('to').value.slice(0,10)}T00:00:00Z`);
    const ceiling = Date.parse(`${new Date().toISOString().slice(0,10)}T00:00:00Z`);
    $('calendar-days').replaceChildren(...Array.from({length:42}, (_,i) => {
        const ms = first + (i - offset) * 86400000;
        const date = new Date(ms);
        const b = element('button', '', String(date.getUTCDate())); b.type='button';
        b.setAttribute('aria-label', date.toISOString().slice(0,10));
        b.classList.toggle('outside', date.getUTCMonth() !== calendarMonth.getUTCMonth());
        b.classList.toggle('selected', ms >= start && ms <= end);
        b.classList.toggle('edge', ms === start || ms === end);
        b.setAttribute('aria-pressed', String(ms >= start && ms <= end));
        b.disabled = ms > ceiling || ms < Date.parse('2019-01-01T00:00:00Z');
        b.onclick = () => {
            if (calendarStart === null) {
                calendarStart = ms;
                $('from').value = inputTime(ms); $('to').value = inputTime(ms + 86400000 - 1000);
                $('calendar-help').textContent = 'Now choose the end date.';
            } else {
                $('from').value = inputTime(Math.min(calendarStart, ms));
                $('to').value = inputTime(Math.max(calendarStart, ms) + 86400000 - 1000);
                calendarStart = null;
                $('calendar-help').textContent = 'Choose a start date, then an end date.';
            }
            drawCalendar();
        };
        return b;
    }));
}

function setRange(from, to, remember = true) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    const ceiling = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) + 86400000;
    from = Math.max(Date.parse('2019-01-01T00:00:00Z'), Math.floor(from / 1000) * 1000);
    to = Math.min(ceiling, Math.ceil(to / 1000) * 1000);
    if (to <= from) return;
    $('from').value = inputTime(from);
    $('to').value = inputTime(to - 1000);
    const url = new URL(location.href);
    url.searchParams.set('from', $('from').value);
    url.searchParams.set('to', $('to').value);
    if (url.href !== location.href) {
        // Initial coverage selection defines the current view; user selections
        // create history entries immediately, independently of fetch completion.
        if (activeRange) history.pushState(null, '', url);
        else history.replaceState(null, '', url);
    }
    $('time-picker').open = false;
    if (remember) {
        if (!recentRanges.some((r) => r.from === from && r.to === to)) recentRanges.unshift({ from, to });
        recentRanges.splice(5);
        $('recent-ranges').replaceChildren(...recentRanges.map((r) => {
            const b = element('button', '', `${displayTime(r.from)} — ${displayTime(r.to - 1000)}`);
            b.type = 'button'; b.onclick = () => setRange(r.from, r.to, false); return b;
        }));
    }
    load();
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

const walletRegistry = createWalletRegistry(element);

for (const definition of CATALOGUE) {
    const card = element('article', `chart-card ${definition.layout || ''}`);
    card.id = `chart-${definition.id}`;
    const heading = element('div', 'chart-heading');
    const title = element('h3', '', definition.title);
    title.id = `title-${definition.id}`;
    const expand = element('button', 'chart-expand', '⛶');
    expand.type = 'button';
    expand.setAttribute('aria-label', `Expand ${definition.title}`);
    expand.setAttribute('aria-haspopup', 'dialog');
    expand.title = 'Expand chart';
    expand.onclick = () => navigateChart(expandedId === definition.id ? null : definition.id);
    heading.append(title);
    const readout = element('div', 'readout');
    const value = element('span', 'readout-value', '—');
    const detail = element('span', 'readout-detail');
    readout.append(value, element('span', 'readout-unit', definition.unit), detail);
    const surface = element('div', 'chart-surface');
    if (definition.id === 'active_wallets_daily') {
        const tabs = element('div', 'activity-tabs');
        tabs.setAttribute('role', 'tablist');
        tabs.setAttribute('aria-label', 'Active wallets interval');
        surface.id = 'active-wallets-panel';
        surface.setAttribute('role', 'tabpanel');
        for (const [i, mode] of activityModes.entries()) {
            const tab = element('button', '', mode[0].toUpperCase() + mode.slice(1));
            tab.type = 'button'; tab.id = `activity-${mode}`; tab.dataset.mode = mode;
            tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', surface.id);
            tab.onclick = () => selectActivity(mode);
            tab.onkeydown = (e) => {
                const index = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : -1;
                if (index < 0) return;
                e.preventDefault(); activityTabs[index].focus(); selectActivity(activityModes[index]);
            };
            activityTabs.push(tab); tabs.append(tab);
        }
        heading.append(tabs);
    }
    surface.append(expand);
    let average;
    let averageValue;
    if (definition.averageUnit) {
        average = element('div', 'chart-average');
        const dot = element('span', 'average-dot');
        dot.style.backgroundColor = definition.series[0].color;
        dot.setAttribute('aria-hidden', 'true');
        averageValue = element('span', '', 'Avg: —');
        average.append(dot, averageValue);
        surface.append(average);
    }
    const legend = element('div', 'chart-legend');
    const status = element('p', 'chart-status');
    card.append(heading, readout, surface, legend, status);
    if (definition.registryTerm) card.append(walletRegistry.description(definition));
    $(`${definition.section}-charts`).append(card);
    const chart = new TimeChart(surface, { ...definition, series: [], loading }, [new Date().toISOString().slice(0, 10)]);
    cards.set(definition.id, { definition, value, detail, legend, status, chart, card, expand, heading, average, averageValue });
}

const expandedDialog = element('dialog', 'expanded-chart');
const expandedPeriod = element('div', 'section-date expanded-period');
expandedPeriod.setAttribute('data-period-label', '');
expandedDialog.append(expandedPeriod);
document.body.append(expandedDialog);
let expandedId = null;
let chartPlaceholder;

function navigateChart(id) {
    const url = new URL(location.href);
    if (id) url.searchParams.set('chart', id);
    else url.searchParams.delete('chart');
    history.pushState(null, '', url);
    syncExpandedChart();
}

function syncExpandedChart(reload = true) {
    const requested = new URLSearchParams(location.search).get('chart');
    const id = cards.has(requested) ? requested : null;
    if (id === expandedId) return;
    const previous = cards.get(expandedId);
    if (previous) {
        expandedDialog.close();
        chartPlaceholder.replaceWith(previous.card);
        previous.chart.surface.append(previous.expand);
        previous.expand.textContent = '⛶';
        previous.expand.setAttribute('aria-label', `Expand ${previous.definition.title}`);
        previous.expand.title = 'Expand chart';
    }
    expandedId = id;
    document.body.classList.toggle('chart-expanded', Boolean(id));
    if (id) {
        const state = cards.get(id);
        chartPlaceholder = document.createComment(`chart-${id}`);
        state.card.before(chartPlaceholder);
        expandedDialog.append(state.card);
        state.heading.append(state.expand);
        expandedDialog.setAttribute('aria-labelledby', `title-${id}`);
        state.expand.textContent = '×';
        state.expand.setAttribute('aria-label', `Close ${state.definition.title}`);
        state.expand.title = 'Close chart (Esc)';
        expandedDialog.showModal();
        state.expand.focus({ preventScroll: true });
    } else previous?.expand.focus({ preventScroll: true });
    // Supply's point budget follows its new plot width.
    if (reload && readings && ([id, previous?.definition.id].some((name) => ['supply', 'inflation', 'accounts', 'activated_wallets', 'active_wallets_daily'].includes(name)))) load();
}

expandedDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    navigateChart(null);
});
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !expandedDialog.open || walletRegistry.dialog.open) return;
    event.preventDefault();
    event.stopPropagation();
    navigateChart(null);
}, true);
expandedDialog.addEventListener('click', (event) => {
    if (event.target !== expandedDialog) return;
    const r = expandedDialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) navigateChart(null);
});
window.addEventListener('popstate', () => {
    const q = new URLSearchParams(location.search);
    const from = q.get('from');
    const to = q.get('to');
    const changedActivity = activityMode !== activityFromURL();
    activityMode = activityFromURL();
    const fromInput = from?.length === 10 ? `${from}T00:00:00` : from;
    const toInput = to?.length === 10 ? `${to}T23:59:59` : to;
    // datetime-local normalizes away :00 seconds; compare instants, not text.
    if (from && to && (Date.parse(`${fromInput}Z`) !== Date.parse(`${$('from').value}Z`) || Date.parse(`${toInput}Z`) !== Date.parse(`${$('to').value}Z`))) {
        $('from').value = fromInput;
        $('to').value = toInput;
        syncExpandedChart(false);
        load();
    } else if (changedActivity) {
        syncExpandedChart(false);
        loadActivity();
    } else syncExpandedChart();
});

function chartGroup(definition) {
    return definition.section === 'wallet' ? 'wallets' : ['supply', 'inflation', 'accounts'].includes(definition.id) ? definition.id : 'observations';
}

function render(group, roundsOnly = false, onlyID) {
    if (!readings) return;
    syncActivityTabs();
    for (const state of cards.values()) {
        const { definition } = state;
        if (onlyID && definition.id !== onlyID) continue;
        const currentGroup = chartGroup(definition);
        if (group && group !== currentGroup) continue;
        if (roundsOnly && !definition.round) continue;
        const isActivity = definition.id === 'active_wallets_daily';
        const loading = pendingCharts.has(currentGroup) || (isActivity && activityLoading);
        const isSupply = definition.id === 'supply';
        const isInflation = definition.id === 'inflation';
        const isAccounts = definition.id === 'accounts';
        const isWallet = definition.section === 'wallet';
        const temporal = isSupply || isInflation || isAccounts || isWallet;
        const series = isWallet ? (walletsData && !(isActivity && (activityError || walletsData.active.mode !== activityMode)) ? [walletSeries(walletsData, definition.id)] : []) : isSupply ? (supplyData ? [supplySeries(supplyData)] : []) : isInflation ? (inflationData ? [inflationSeries(inflationData)] : []) : isAccounts ? (accountsData ? accountsSeries(accountsData) : []) : readings.metrics[definition.id]?.series || [];
        const dates = temporal ? (series[0]?.points.map((p) => p[0]) || []) : definition.round ? readings.roundDates : readings.dates;
        const shownDates = dates.length ? dates : temporal && activeRange ? [new Date(activeRange.from).toISOString()] : readings.dates;
        const rows = buildRows(shownDates, series);
        const latest = isWallet ? rows.findLast((r) => r.values.some(Number.isFinite)) : temporal ? (dates.length ? rows.at(-1) : undefined) : rows.findLast((r) =>
            definition.kind.startsWith('stacked') ? r.total !== null : r.values.some(Number.isFinite),
        );
        const value = latest
            ? definition.kind.startsWith('stacked')
                ? latest.total
                : latest.values.find(Number.isFinite)
            : null;
        state.value.textContent = formatSummary(value, definition.unit);
        state.detail.textContent = latest ? formatDate(latest.date, { seconds: isSupply || isAccounts || definition.id === 'activated_wallets' || definition.round }) : '';
        state.status.textContent =
            (isSupply ? supplyError : isInflation ? inflationError : isAccounts ? accountsError : definition.id === 'validator_count' ? validatorsError : wideRange && definition.section !== 'wallet' && !['fees', 'minted', 'burned', 'transactions'].includes(definition.id) ? 'Zoom to 93 days or less for activity and validator geography charts.' : '') ||
            definition.unavailable ||
            definition.description ||
            (latest
                ? series.find((s) => s.details?.[latest.date])?.details[latest.date] || ''
                : 'No covered observations in this interval.');
        if (isWallet) {
            const totalDays = activeRange ? Math.ceil(activeRange.to / 86400000) - Math.floor(activeRange.from / 86400000) : 0;
            const isActivity = definition.id === 'active_wallets_daily';
            const available = (isActivity ? walletsData?.active.coverageDays : walletsData?.coverageDays)?.length ?? 0;
            const interval = isActivity ? `${{hourly:'Unique wallets per UTC hour.',daily:'Unique wallets per UTC day.',monthly:'Unique wallets over 30 complete UTC days ending on each displayed day.'}[activityMode]} ${walletsData?.active.sampleStepSeconds > walletsData?.active.intervalSeconds ? 'Selected hourly observations shown; zoom in for every hour. ' : ''}` : '';
            const missing = isActivity && activityMode === 'monthly' ? 'Each point requires 30 prepared days; incomplete or not-yet-prepared windows are omitted.' : 'History is being prepared.';
            state.status.textContent = (isActivity ? activityError || (walletsData?.active.mode === activityMode ? '' : walletsError) : walletsError) || (loading ? 'Loading wallet data…' : `${interval}${available ? available < totalDays ? `${available} of ${totalDays} UTC days available. ${missing}` : '' : missing}`);
        }
        state.legend.replaceChildren();
        if (state.average) {
            const avg = dailyAverage(dates, series[0]);
            const period = activeRange ? rangeDurationLabel(activeRange.from, activeRange.to) : `${dates.length}d`;
            state.averageValue.textContent = `Avg (${period}): ${loading || avg.value === null ? '—' : `${avg.value} ${definition.averageUnit}${avg.partial ? ' · partial' : ''}`}`;
            state.average.title = loading ? 'Loading daily values.' : `Mean of ${avg.count} available UTC-day totals out of ${avg.total} displayed days. Missing values are excluded; partial day totals are included and marked partial. Intraday selections use whole UTC-day totals, as shown in the chart.`;
        }
        if (series.length > 1)
            for (const s of isAccounts ? [...series].reverse() : series) {
                const item = element('span', 'legend-item');
                const swatch = element('span', 'swatch');
                swatch.style.backgroundColor = s.color;
                item.append(swatch, document.createTextNode(s.label));
                state.legend.append(item);
            }
        state.chart.update({ ...definition, series, loading, time: temporal,
            rangeStart: activeRange?.from, rangeEnd: activeRange?.to,
            onRange: (from, to) => setRange(from, to),
        }, shownDates);
    }
    const label = activeRange ? `${displayTime(activeRange.from)} — ${displayTime(activeRange.to - 1000)} UTC` : '';
    $('period-status').textContent = label;
    document.querySelectorAll('[data-period-label]').forEach((n) => (n.textContent = label));
    $('source-status').textContent = coverage
        .map(
            (s) => `${s.source}: ${s.first_day ?? 'none'}–${s.last_day ?? 'none'} · updated ${s.updated_at ? formatDate(s.updated_at) : 'never'}`,
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
    const start = Date.parse(`${$('from').value}Z`);
    const end = Date.parse(`${$('to').value}Z`) + 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Choose a valid UTC interval.');
    activeRange = { from: start, to: end };
    $('range-label').textContent = `${displayTime(start)} — ${displayTime(end - 1000)}`;
    const from = new Date(start).toISOString().slice(0, 10);
    const to = new Date(Math.ceil(end / 86400000) * 86400000).toISOString().slice(0, 10);
    wideRange = Date.parse(to) - Date.parse(from) > 93 * 86400000;
    return { from, to };
}

function load() {
    activityRequest++;
    activityController?.abort();
    activityLoading = false;
    activityError = '';
    rangeLoad = loadRange();
    return rangeLoad;
}

async function loadRange() {
    const id = ++requestId;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 25000);
    loading = true;
    pendingCharts.clear();
    for (const group of ['wallets', 'supply', 'inflation', 'accounts', 'observations']) pendingCharts.add(group);
    supplyData = undefined;
    supplyError = '';
    inflationData = undefined;
    inflationError = '';
    accountsData = undefined;
    accountsError = '';
    walletsData = undefined;
    walletsError = '';
    validatorsError = '';
    $('apply').disabled = true;
    warning('');
    geoRequest++;
    $('geo-round').replaceChildren();
    $('geo-round').disabled = true;
    $('geo-locations').replaceChildren();
    // Do not retain another date range behind a failed reload.
    try {
        const range = selection();
        const dailyRange = range;
        const empty = { schemaVersion: 2, network: 'mainnet', period: dailyRange, chain: [], daily: [], stars: [], rounds: [] };
        readings = readObservedMetrics({
            schemaVersion: 2,
            network: 'mainnet',
            period: dailyRange,
            chain: [],
            daily: [],
            stars: [],
            rounds: [],
        });
        render();
        const budget = Math.max(100, Math.min(1200, Math.round(cards.get('supply').chart.surface.clientWidth)));
        const supplyParams = new URLSearchParams({ from: new Date(activeRange.from).toISOString().replace('.000Z','Z'), to: new Date(activeRange.to).toISOString().replace('.000Z','Z'), maxPoints: String(budget) });
        const inflationParams = new URLSearchParams(supplyParams);
        inflationParams.set('maxPoints',String(Math.max(100,Math.min(1200,Math.round(cards.get('inflation').chart.surface.clientWidth)))));
        const accountsParams = new URLSearchParams(supplyParams);
        accountsParams.set('maxPoints',String(Math.max(100,Math.min(1200,Math.round(cards.get('accounts').chart.surface.clientWidth)))));
        const walletParams = new URLSearchParams(supplyParams);
        walletParams.set('activity', activityMode);
        walletParams.set('maxPoints', String(Math.max(100, Math.min(1200, Math.round(cards.get(expandedId === 'active_wallets_daily' ? 'active_wallets_daily' : 'activated_wallets').chart.surface.clientWidth)))));
        const chartTask = (group, path, accept) => async () => {
            const data = await getJSON(path, request.signal).catch((e) => ({ error: e.message }));
            if (id !== requestId) return;
            accept(data);
            pendingCharts.delete(group);
            render(group);
        };
        // Four workers match the API's cold-reader limit. Wallets starts at once;
        // each completed group renders only its own charts.
        const tasks = [
            chartTask('wallets', `/api/v1/wallets?${walletParams}`, (data) => {
                if (data.error) walletsError = `Wallets unavailable: ${data.error}`;
                else walletsData = data;
            }),
            chartTask('supply', `/api/v1/supply?${supplyParams}`, (data) => {
                if (data.error) supplyError = `Supply unavailable: ${data.error}`;
                else supplyData = data;
            }),
            chartTask('inflation', `/api/v1/inflation?${inflationParams}`, (data) => {
                if (data.error) inflationError = `Inflation unavailable: ${data.error}`;
                else inflationData = data;
            }),
            chartTask('accounts', `/api/v1/accounts?${accountsParams}`, (data) => {
                if (data.error) accountsError = `Accounts unavailable: ${data.error}`;
                else accountsData = data;
            }),
            async () => {
                try {
                    const data = await getJSON(`/api/v1/${wideRange ? 'chain' : 'dashboard'}?${new URLSearchParams(range)}`, request.signal);
                    if (id !== requestId) return;
                    readings = readObservedMetrics({ ...empty, ...data });
                    pendingCharts.delete('observations');
                    render('observations');
                    if (wideRange) {
                        const validators = await getJSON(`/api/v1/validators?${new URLSearchParams(range)}`, request.signal).catch((e) => ({ error: e.message }));
                        if (id !== requestId) return;
                        if (validators.error) validatorsError = `Validators unavailable: ${validators.error}`;
                        readings = readObservedMetrics({ ...empty, ...data, rounds: validators.rounds || [] });
                        render('observations', true);
                    }
                    renderRounds();
                } catch (e) {
                    if (id !== requestId) return;
                    warning(`Data could not be loaded. ${e.message}`);
                    pendingCharts.delete('observations');
                    render('observations');
                }
            },
            async () => {
                const sources = await getJSON('/api/v1/coverage', request.signal).catch(() => null);
                if (id !== requestId || !sources) return;
                coverage = sources.coverage;
                render('coverage');
            },
        ];
        await Promise.all(Array.from({ length: 4 }, async () => {
            while (tasks.length && id === requestId && !request.signal.aborted) await tasks.shift()();
        }));
    } catch (e) {
        if (id === requestId)
            warning(`Data could not be loaded. ${e.name === 'AbortError' ? 'Request timed out.' : e.message}`);
    } finally {
        clearTimeout(timeout);
        if (id === requestId) {
            loading = false;
            $('apply').disabled = false;
            if (pendingCharts.size) {
                pendingCharts.clear();
                render();
            }
        }
    }
}

function renderRounds() {
    const list = $('geo-round');
    list.replaceChildren();
    for (const [date, r] of Object.entries(readings.roundDetails)) {
        if (r.located == null) continue;
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
            `${snapshot.located}/${snapshot.total} located · ${snapshot.unknown} unknown · updated ${formatDate(snapshot.calculated_at)}`,
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
    setRange(Date.parse(`${$('from').value}Z`), Date.parse(`${$('to').value}Z`) + 1000);
});
$('time-picker').addEventListener('toggle', () => {
    if (!$('time-picker').open) return;
    const from = new Date(`${$('from').value || inputTime(Date.now())}Z`);
    calendarMonth = new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth(),1));
    calendarStart = null;
    $('calendar-help').textContent = 'Choose a start date, then an end date.';
    drawCalendar();
});
for (const [id,direction] of [['calendar-prev',-1],['calendar-next',1]]) $(id).onclick = () => {
    calendarMonth = new Date(Date.UTC(calendarMonth.getUTCFullYear(),calendarMonth.getUTCMonth()+direction,1)); drawCalendar();
};
for (const id of ['from','to']) $(id).addEventListener('change',drawCalendar);
$('retry').addEventListener('click', () => (readings ? load() : loadLatest()));
$('geo-round').addEventListener('change', loadLocations);
function indexedBounds() {
    const supply = coverage.find((s) => s.source === 'supply');
    if (supply?.last_utime != null) return { from: supply.first_utime * 1000, to: (supply.last_utime + 1) * 1000 };
    const range = latestChainRange(coverage);
    if (!range) return null;
    return { from: Date.parse(`${range.from}T00:00:00Z`), to: Date.parse(`${range.to}T00:00:00Z`) + 86400000 };
}
for (const [label, seconds] of [
    ['5 minutes', 300], ['1 hour', 3600], ['24 hours', 86400],
    ['7 days', 7 * 86400], ['30 days', 30 * 86400], ['90 days', 90 * 86400],
    ['180 days', 180 * 86400], ['1 year', 365 * 86400], ['2 years', 730 * 86400],
]) {
    const b = element('button', '', `Last ${label}`); b.type = 'button';
    b.onclick = () => loadLatest(seconds);
    $('range-presets').append(b);
}
$('range-search').addEventListener('input', (e) => {
    document.querySelectorAll('.quick-ranges button').forEach((b) => b.hidden = !b.textContent.toLowerCase().includes(e.target.value.toLowerCase()));
});
$('range-all').onclick = () => {
    const b = indexedBounds();
    if (b) {
        const firstDay = coverage.find((s) => s.source === 'chain')?.first_day;
        setRange(firstDay ? Math.min(b.from, Date.parse(`${firstDay}T00:00:00Z`)) : b.from, b.to);
    }
};
for (const [id, direction] of [['range-prev',-1],['range-next',1]]) $(id).onclick = () => {
    if (!activeRange) return;
    const span = activeRange.to - activeRange.from;
    setRange(activeRange.from + direction * span, activeRange.to + direction * span);
};
$('range-out').onclick = () => {
    if (!activeRange) return;
    const half = (activeRange.to - activeRange.from) / 2;
    setRange(activeRange.from - half, activeRange.to + half);
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('time-picker').open = false; });
document.addEventListener('pointerdown', (e) => { if (!$('time-picker').contains(e.target)) $('time-picker').open = false; });
async function loadLatest(seconds = 7 * 86400) {
    const id = ++requestId;
    controller?.abort();
    loading = true;
    $('apply').disabled = true;
    warning('');
    try {
        const sources = await getJSON('/api/v1/coverage', AbortSignal.timeout(20000));
        if (id !== requestId) return;
        coverage = sources.coverage;
        const range = indexedBounds();
        if (!range) throw new Error('No prepared chain history is available yet.');
        setRange(Math.max(range.from, range.to - seconds * 1000), range.to);
    } catch (e) {
        if (id === requestId) warning(`Data could not be loaded. ${e.message}`);
    } finally {
        if (id === requestId) {
            loading = false;
            $('apply').disabled = false;
        }
    }
}
const params = new URLSearchParams(location.search);
syncExpandedChart();
$('to').max = $('from').max = `${new Date().toISOString().slice(0, 10)}T23:59:59`;
if (params.has('from') && params.has('to')) {
    $('from').value = params.get('from').length === 10 ? `${params.get('from')}T00:00:00` : params.get('from');
    $('to').value = params.get('to').length === 10 ? `${params.get('to')}T23:59:59` : params.get('to');
    load();
} else loadLatest();
setInterval(
    () => {
        if (!loading && !document.hidden) readings ? load() : loadLatest();
    },
    5 * 60 * 1000,
);
