// actions_total_v1: this taxonomy is frozen together with the aggregator's
// internal/gramstat/handlers/actions/types.go. Filtering never reclassifies children.
export const ACTION_METRIC = 'actions_total_v1';
export const ACTION_GROUPS = [
    ['gram', 'GRAM transfers', '#508ac4', 'ton_transfer'],
    ['jettons', 'Jetton transfers', '#5c9980', 'jetton_transfer'],
    ['swaps', 'Swaps', '#a38abd', 'jetton_swap'],
    ['liquidity', 'Liquidity', '#c3934f', 'dex_deposit_liquidity dex_withdraw_liquidity dedust_v2_claim_fees dedust_v2_claim_reward'],
    ['staking', 'Staking', '#379687', 'stake_deposit stake_withdrawal stake_withdrawal_request jvault_stake jvault_unstake jvault_claim jvault_unstake_request coffee_staking_claim_rewards coffee_staking_deposit coffee_staking_withdraw'],
    ['nft', 'NFT transfers', '#c27870', 'nft_transfer'],
    ['marketplace', 'NFT marketplace', '#b774a0', 'nft_purchase nft_put_on_sale nft_put_on_auction nft_cancel_sale nft_cancel_auction nft_finish_auction nft_update_sale auction_bid auction_outbid teleitem_start_auction teleitem_cancel_auction'],
    ['issuance', 'Mint / burn', '#859c4c', 'jetton_mint jetton_burn nft_mint'],
    ['dns', 'DNS', '#7697ad', 'change_dns delete_dns renew_dns dns_purchase dns_release'],
    ['lending', 'Lending', '#b89876', 'evaa_supply evaa_withdraw evaa_liquidate'],
    ['bridges', 'Bridges', '#8d84c2', 'layerzero_send layerzero_send_tokens layerzero_receive'],
    ['other', 'Other recognized actions', '#8999a2', 'subscribe unsubscribe multisig_create_order multisig_approve multisig_execute vesting_send_message vesting_add_whitelist change_wallet_key cocoon_worker_payout cocoon_proxy_payout cocoon_proxy_charge cocoon_client_top_up cocoon_register_proxy cocoon_unregister_proxy cocoon_client_register cocoon_client_change_secret_hash cocoon_client_request_refund cocoon_grant_refund cocoon_client_increase_stake cocoon_client_withdraw'],
].map(([id, label, color, types]) => ({ id, label, color, types: types.split(' ') }));
export const ACTION_TYPES = ACTION_GROUPS.flatMap(group => group.types);
const knownTypes = new Set(ACTION_TYPES);
const integer = value => typeof value === 'string' && /^\d+$/.test(value);

export function excludedActionTypes(params) {
    return new Set((params.get('excludeActions') || '').split(',').filter(type => knownTypes.has(type)));
}

export function actionTypeReadings(rows, dates) {
    const types = [...ACTION_TYPES, 'total'];
    const series = types.map(id => ({ id, label: id, points: [], exact: {}, partial: {}, details: {} }));
    const byDay = new Map();
    for (const row of rows.filter(row => row.metric === ACTION_METRIC)) {
        if (byDay.has(row.day)) throw Error('Duplicate total actions day.');
        const entries = Object.entries(row.breakdown || {});
        if (!integer(row.value) || entries.some(([type, value]) => !knownTypes.has(type) || !integer(value))
            || entries.reduce((sum, [, value]) => sum + BigInt(value), 0n) !== BigInt(row.value))
            throw Error('Inconsistent total actions breakdown.');
        byDay.set(row.day, row);
    }
    for (const date of dates) {
        const row = byDay.get(date);
        for (const s of series) {
            const exact = row ? s.id === 'total' ? row.value : row.breakdown?.[s.id] ?? '0' : null;
            s.exact[date] = exact;
            s.points.push([date, exact === null ? null : Number(exact)]);
            s.partial[date] = Boolean(row?.is_partial);
        }
    }
    return series;
}

// Exact sums drive labels; plot coordinates use precisely the same addition as
// the visible stack, so even counts beyond Number's exact range share its edge.
export function totalActionSeries(raw, excluded = new Set()) {
    const lookup = new Map(raw.map(s => [s.id, s]));
    const reference = lookup.get('total');
    if (!reference) return [];
    const groups = ACTION_GROUPS.flatMap(group => {
        const types = group.types.filter(type => !excluded.has(type));
        if (!types.length) return [];
        const s = { ...group, points: [], exact: {}, partial: {}, details: {}, fillOpacity: 0.42 };
        for (const [date] of reference.points) {
            const values = types.map(type => lookup.get(type)?.exact[date]);
            const exact = values.every(integer) ? values.reduce((sum, v) => sum + BigInt(v), 0n).toString() : null;
            s.exact[date] = exact;
            s.points.push([date, exact === null ? null : Number(exact)]);
            s.partial[date] = types.some(type => lookup.get(type)?.partial[date]);
            s.details[date] = types.length === group.types.length ? '' : `Selected types: ${types.join(', ')}.`;
        }
        return [s];
    });
    if (!groups.length) return [];
    const total = { id: 'total', label: excluded.size ? 'Total · selected types' : 'Total', color: 'var(--text)', overlay: true, points: [], exact: {}, partial: {}, details: {} };
    reference.points.forEach(([date], i) => {
        const values = groups.map(s => s.exact[date]);
        const exact = values.every(integer) ? values.reduce((sum, v) => sum + BigInt(v), 0n).toString() : null;
        total.exact[date] = exact;
        total.points.push([date, exact === null ? null : groups.reduce((sum, s) => sum + s.points[i][1], 0)]);
        total.partial[date] = groups.some(s => s.partial[date]);
    });
    return [...groups, total];
}

export function createActionLegend(host, getExcluded, onChange) {
    const make = (tag, className, text) => {
        const el = document.createElement(tag); el.className = className;
        if (text !== undefined) el.textContent = text;
        return el;
    };
    host.classList.add('action-category-legend');
    const all = make('button', 'action-select-all', 'Select all'); all.type = 'button';
    all.addEventListener('click', () => { getExcluded().clear(); onChange(); });
    const controls = [], menus = [];
    const position = ({ dropdown, panel }) => {
        if (!dropdown.open) return;
        panel.style.setProperty('--action-panel-shift', '0px');
        const rect = panel.getBoundingClientRect();
        panel.style.setProperty('--action-panel-shift', `${Math.max(16 - rect.left, Math.min(0, innerWidth - 16 - rect.right))}px`);
    };
    for (const group of ACTION_GROUPS) {
        const section = make('div', 'action-category');
        const dropdown = make('details', 'action-legend');
        const summary = make('summary', '', '▾');
        summary.setAttribute('aria-label', `Types in ${group.label}`);
        summary.title = `Choose types in ${group.label}`;
        const panel = make('div', 'action-legend-panel');
        panel.id = `action-types-${group.id}`; summary.setAttribute('aria-controls', panel.id);
        const menu = { section, dropdown, summary, panel }; menus.push(menu);
        const opened = () => {
            if (dropdown.open) {
                for (const other of menus) if (other !== menu) other.dropdown.open = false;
                position(menu);
            }
        };
        summary.addEventListener('click', e => {
            e.preventDefault(); dropdown.open = !dropdown.open; opened();
        });
        dropdown.addEventListener('toggle', opened);
        const checkbox = (labelText, types, container, color, key) => {
            const label = make('label', 'action-type-choice');
            const input = make('input', ''); input.type = 'checkbox'; input.dataset.actionType = key;
            label.append(input);
            if (color) { const swatch = make('span', 'swatch'); swatch.style.backgroundColor = color; label.append(swatch); }
            label.append(document.createTextNode(labelText)); container.append(label);
            input.addEventListener('change', () => {
                for (const type of types) input.checked ? getExcluded().delete(type) : getExcluded().add(type);
                onChange();
            });
            controls.push({ input, types, category: container === section ? section : null });
        };
        checkbox(group.label, group.types, section, group.color, group.id);
        for (const type of group.types) checkbox(type, [type], panel, null, type);
        dropdown.append(summary, panel); section.append(dropdown); host.append(section);
    }
    host.append(all);
    document.addEventListener('click', e => {
        for (const menu of menus) if (!menu.section.contains(e.target)) menu.dropdown.open = false;
    });
    window.addEventListener('resize', () => menus.forEach(position));
    host.addEventListener('keydown', e => {
        const menu = menus.find(menu => menu.dropdown.open);
        if (e.key === 'Escape' && menu) { e.preventDefault(); e.stopPropagation(); menu.dropdown.open = false; menu.summary.focus(); }
    });
    return () => {
        const excluded = getExcluded();
        all.disabled = excluded.size === 0;
        for (const { input, types, category } of controls) {
            const enabled = types.filter(type => !excluded.has(type)).length;
            input.checked = enabled === types.length;
            input.indeterminate = enabled > 0 && enabled < types.length;
            if (category) {
                category.classList.toggle('is-disabled', enabled === 0);
                input.parentElement.title = `${enabled} of ${types.length} types selected`;
            }
        }
    };
}
