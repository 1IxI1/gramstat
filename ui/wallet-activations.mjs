import { WALLET_CODES } from './wallet-registry.mjs';
import { walletSeries } from './data.mjs';
import { sumReadings } from './charts.mjs';

export const WALLET_VERSIONS = [...new Map(WALLET_CODES.map(c => [c.type, { id: c.type, label: c.name }])).values()];
export const OTHER_WALLETS = WALLET_VERSIONS.filter(v => v.id !== 'wallet_tg');
const known = new Set(OTHER_WALLETS.map(v => v.id));
const integer = v => typeof v === 'string' && /^\d+$/.test(v);
const groups = [
    { id: 'tg', label: 'Tg-wallet', color: '#508ac4', fillOpacity: 0.45 },
    { id: 'others', label: 'Others', color: '#c3934f', fillOpacity: 0.3 },
];
const totalStyle = { id: 'total', label: 'Total', color: 'var(--text)', overlay: true };
const controls = [...groups, totalStyle];

export function activationSelection(params) {
    return {
        hidden: new Set((params.get('hideActivations') || '').split(',').filter(v => controls.some(g => g.id === v))),
        excluded: new Set((params.get('excludeWallets') || '').split(',').filter(v => known.has(v))),
    };
}

export function writeActivationSelection(params, selection) {
    for (const [key, values] of [
        ['hideActivations', controls.filter(g => selection.hidden.has(g.id)).map(g => g.id)],
        ['excludeWallets', OTHER_WALLETS.filter(v => selection.excluded.has(v.id)).map(v => v.id)],
    ]) {
        if (values.length) params.set(key, values.join(','));
        else params.delete(key);
    }
}

export function activationSeries(data, selection) {
    const reference = walletSeries(data, 'activations');
    const byTime = new Map();
    for (const row of data.activations.points) {
        const date = new Date(row.utime * 1000).toISOString();
        if (byTime.has(date)) throw Error('Duplicate activation day.');
        const values = row.versions;
        if (values != null && (Object.keys(values).length !== WALLET_VERSIONS.length ||
            !integer(row.value) || WALLET_VERSIONS.some(v => !integer(values[v.id])) ||
            Object.values(values).reduce((sum, v) => sum + BigInt(v), 0n) !== BigInt(row.value)))
            throw Error('Inconsistent wallet activation versions.');
        byTime.set(date, values);
    }
    const others = OTHER_WALLETS.filter(v => !selection.excluded.has(v.id));
    const layers = groups.filter(g => !selection.hidden.has(g.id) && (g.id === 'tg' || others.length)).map(g => {
        const types = g.id === 'tg' ? ['wallet_tg'] : others.map(v => v.id);
        const s = { ...g, label: g.label + (g.id === 'others' && others.length !== OTHER_WALLETS.length ? ` (${others.length}/${OTHER_WALLETS.length})` : ''),
            points: [], exact: {}, partial: reference.partial, details: {} };
        for (const [date] of reference.points) {
            const values = byTime.get(date);
            const exact = values ? types.reduce((sum, type) => sum + BigInt(values[type]), 0n).toString() : null;
            s.exact[date] = exact;
            s.points.push([date, exact === null ? null : Number(exact)]);
            s.details[date] = reference.details[date] + (g.id === 'others' && others.length < OTHER_WALLETS.length ? ` Others: ${others.map(v => v.label).join(', ')}.` : '');
        }
        return s;
    });
    if (selection.hidden.has('total')) return layers;
    // Like Total Stake Locked, the reference remains independent of visibility
    // and subtype filters. Complete maps use the unfiltered stack's coordinate
    // arithmetic; a known source Total survives even an unavailable breakdown.
    const total = { ...reference, ...totalStyle, points: reference.points.map(([date, value]) => {
        const versions = byTime.get(date);
        if (!versions) return [date, value];
        const others = OTHER_WALLETS.reduce((sum, v) => sum + BigInt(versions[v.id]), 0n);
        return [date, sumReadings([Number(versions.wallet_tg), Number(others)])];
    }) };
    return [...layers, total];
}

// The readout/average follows the visible global Total. With Total hidden, it
// follows only the selected stack, allowing a single version to be inspected.
export function activationTotal(series) {
    const reference = series.find(s => s.overlay);
    if (reference) return reference;
    series = series.filter(s => !s.overlay);
    const total = { ...totalStyle, points: [], exact: {}, partial: {} };
    for (const [date, i] of (series[0]?.points || []).map(([date], i) => [date, i])) {
        const values = series.map(s => s.exact[date]);
        total.exact[date] = values.every(integer) ? values.reduce((sum, v) => sum + BigInt(v), 0n).toString() : null;
        total.points.push([date, sumReadings(series.map(s => s.points[i][1]))]);
        total.partial[date] = series.some(s => s.partial[date]);
    }
    return total;
}

export function createActivationLegend(host, getSelection, onChange) {
    const make = (tag, cls, text) => {
        const el = document.createElement(tag); el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    host.classList.add('action-category-legend');
    const toggles = [];
    let dropdown, panel, summary, menuSection;
    for (const g of controls) {
        const section = make('div', 'action-category');
        const toggle = make('button', 'legend-item action-category-toggle');
        toggle.type = 'button'; toggle.dataset.activationGroup = g.id;
        const swatch = make('span', 'swatch'); swatch.style.backgroundColor = g.color;
        const caption = document.createTextNode(g.label);
        toggle.append(swatch, caption); section.append(toggle);
        toggle.onclick = () => {
            const { hidden } = getSelection();
            hidden.has(g.id) ? hidden.delete(g.id) : hidden.add(g.id);
            onChange();
        };
        toggles.push({ g, toggle, caption });
        if (g.id === 'others') {
            menuSection = section;
            dropdown = make('details', 'action-legend');
            summary = make('summary', '', '▾');
            summary.setAttribute('aria-label', 'Wallet versions in Others');
            panel = make('div', 'action-legend-panel');
            panel.id = 'activation-wallet-versions'; summary.setAttribute('aria-controls', panel.id);
            dropdown.append(summary, panel); section.append(dropdown);
        }
        host.append(section);
    }
    const all = make('button', 'action-select-all'); all.type = 'button';
    all.onclick = () => {
        const { excluded } = getSelection();
        if (excluded.size === 0) for (const v of OTHER_WALLETS) excluded.add(v.id);
        else excluded.clear();
        onChange();
    };
    panel.append(all);
    const inputs = OTHER_WALLETS.map(v => {
        const label = make('label', 'action-type-choice');
        const input = make('input', ''); input.type = 'checkbox'; input.dataset.walletVersion = v.id;
        input.onchange = () => {
            input.checked ? getSelection().excluded.delete(v.id) : getSelection().excluded.add(v.id);
            onChange();
        };
        label.append(input, document.createTextNode(v.label)); panel.append(label);
        return { input, id: v.id };
    });
    const position = () => {
        if (!dropdown.open) return;
        panel.style.setProperty('--action-panel-shift', '0px');
        const r = panel.getBoundingClientRect();
        panel.style.setProperty('--action-panel-shift', `${Math.max(16-r.left, Math.min(0, innerWidth-16-r.right))}px`);
    };
    summary.onclick = e => { e.preventDefault(); dropdown.open = !dropdown.open; position(); };
    dropdown.addEventListener('toggle', position);
    window.addEventListener('resize', position);
    document.addEventListener('click', e => { if (!menuSection.contains(e.target)) dropdown.open = false; });
    host.addEventListener('keydown', e => {
        if (e.key === 'Escape' && dropdown.open) {
            e.preventDefault(); e.stopPropagation(); dropdown.open = false; summary.focus();
        }
    });
    return () => {
        const { hidden, excluded } = getSelection();
        const count = OTHER_WALLETS.length-excluded.size;
        for (const { g, toggle, caption } of toggles) {
            toggle.setAttribute('aria-pressed', String(!hidden.has(g.id)));
            caption.data = g.label + (g.id === 'others' && count !== OTHER_WALLETS.length ? ` (${count}/${OTHER_WALLETS.length})` : '');
        }
        for (const { input, id } of inputs) input.checked = !excluded.has(id);
        all.textContent = excluded.size === 0 ? 'Select none' : 'Select all';
        position();
    };
}
