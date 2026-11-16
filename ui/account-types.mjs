// Counts remain BigInt throughout navigation; only SVG geometry uses Number.
export const TYPE_ORDER = ['Wallets', 'Jettons', 'NFTs', 'NFT markets', 'DeFi', 'Other recognized', 'Mixed', 'Unknown'];
const palette = ['#168ac0', '#5c9980', '#a18abc', '#c49a52', '#568f9b', '#ac8b80', '#c27896', '#929ca8'];
const integer = value => BigInt(value).toLocaleString('en-US');
const sum = rows => rows.reduce((n, row) => n + BigInt(row.accounts), 0n);

export function typePercent(value, total) {
    const n = BigInt(value), d = BigInt(total);
    if (d === 0n) return '—';
    const scaled = n * 10000n / d;
    if (n > 0n && scaled === 0n) return '<0.01%';
    return `${scaled / 100n}${scaled % 100n ? `.${String(scaled % 100n).padStart(2, '0').replace(/0+$/, '')}` : ''}%`;
}

export function compactAccounts(value) {
    const n = BigInt(value);
    for (const [unit, size] of [['B', 1000000000n], ['M', 1000000n], ['K', 1000n]]) {
        if (n >= size) {
            const scaled = n * 10n / size;
            return `${scaled / 10n}${scaled % 10n ? `.${scaled % 10n}` : ''}${unit}`;
        }
    }
    return String(n);
}

export function partitionTypes(rows, total, maximum = 8) {
    const visible = rows.slice(0, maximum);
    const remainder = BigInt(total) - sum(visible);
    if (remainder < 0n) throw Error('Type counts exceed their parent.');
    return { visible, remainder: String(remainder) };
}

export function typeChildren(nodes, parent) {
    return nodes.filter(n => n.parent === parent).sort((a, b) => {
        if (parent === 'all') return TYPE_ORDER.indexOf(a.label) - TYPE_ORDER.indexOf(b.label);
        const x = BigInt(a.accounts), y = BigInt(b.accounts);
        return x === y ? a.label.localeCompare(b.label) : x > y ? -1 : 1;
    });
}

function el(tag, className = '', text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function button(label, action, className = '') {
    const b = el('button', className, label);
    b.type = 'button'; b.onclick = action;
    return b;
}
function svg(tag, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
}
function point(radius, angle) {
    return [130 + radius * Math.cos(angle), 130 + radius * Math.sin(angle)].map(n => n.toFixed(4)).join(' ');
}
function sector(start, length) {
    // Two arcs also represent a full circle without a zero-length SVG arc.
    const middle = start + length / 2, end = start + length;
    return `M ${point(108, start)} A 108 108 0 0 1 ${point(108, middle)} A 108 108 0 0 1 ${point(108, end)}
        L ${point(76, end)} A 76 76 0 0 0 ${point(76, middle)} A 76 76 0 0 0 ${point(76, start)} Z`;
}
function color(row) {
    const root = TYPE_ORDER.indexOf(row.label);
    const hash = [...(row.id || row.codeHash || row.label)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
    return palette[root < 0 ? hash % palette.length : root];
}
const timestamp = value => new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
}).format(new Date(value)) + ' UTC';

export class AccountTypes {
    constructor(container) {
        this.container = container;
        this.sequence = 0;
        this.panelSequence = 0;
        this.frames = [];
        this.cache = new Map();
        this.card = el('article', 'chart-card account-types');
        this.card.id = 'chart-account_types';
        this.card.setAttribute('aria-labelledby', 'account-types-title');
        const heading = el('div', 'chart-heading');
        const title = el('h3', '', 'Account types'); title.id = 'account-types-title';
        const actions = el('div', 'account-type-actions');
        this.refresh = button('↻', () => this.load(true), 'type-icon');
        this.refresh.setAttribute('aria-label', 'Refresh account types');
        this.expand = button('⛶', () => this.toggleExpanded(), 'type-icon');
        this.expand.setAttribute('aria-label', 'Expand account types');
        this.expand.setAttribute('aria-haspopup', 'dialog');
        actions.append(this.refresh, this.expand); heading.append(title, actions);
        this.time = el('p', 'account-type-time', 'Latest snapshot');
        this.breadcrumbs = el('nav', 'type-breadcrumbs'); this.breadcrumbs.setAttribute('aria-label', 'Account type path');
        this.body = el('div', 'type-body');
        this.message = el('p', 'type-message', 'Loading account types…'); this.message.setAttribute('role', 'status');
        this.tooltip = el('div', 'type-tooltip'); this.tooltip.hidden = true;
        const about = el('details', 'type-about');
        const population = el('p');
        population.append(el('strong', '', 'Latest'),
            ' indexed active accounts with code, across all workchains. Updated every 10 minutes, independently of the time range above. Each account belongs to exactly one category. Counts are collected over an observation interval (~20s) rather than at a single instant. Active accounts without code are excluded from the total.');
        const methods = el('p');
        methods.append(el('em', '', 'By get methods'),
            ' means the account type is inferred by matching method IDs extracted from disassembled contract bytecode against known interface patterns.');
        about.append(el('summary', '', 'About this distribution'), population, methods);
        this.card.append(heading, this.time, this.breadcrumbs, this.body, this.message, about, this.tooltip);
        container.append(this.card);
        this.expanded = el('dialog', 'type-expanded');
        this.expanded.setAttribute('aria-labelledby', title.id);
        this.panel = el('dialog', 'type-panel');
        this.panel.setAttribute('aria-labelledby', 'type-panel-title');
        document.body.append(this.expanded, this.panel);
        this.expanded.addEventListener('cancel', event => { event.preventDefault(); this.toggleExpanded(); });
        this.expanded.addEventListener('click', event => {
            if (event.target === this.expanded && this.outside(this.expanded, event)) this.toggleExpanded();
        });
        this.panel.addEventListener('click', event => {
            if (event.target === this.panel && this.outside(this.panel, event)) this.panel.close();
        });
        this.panel.addEventListener('close', () => { this.panelSequence++; this.listState = null; });
    }

    outside(dialog, event) {
        const r = dialog.getBoundingClientRect();
        return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    }

    async request(params = {}) {
        const response = await fetch(`/api/v1/accounts/types?${new URLSearchParams(params)}`, {
            signal: AbortSignal.timeout(25000), cache: 'no-cache', headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw Error(`Request failed (${response.status}).`);
        const data = await response.json();
        if (data.schemaVersion !== 1) throw Error('Unsupported account types response.');
        if (params.publication && data.snapshot?.publicationId !== params.publication) throw Error('Snapshot changed.');
        return data;
    }

    async load(force = false) {
        if (this.loading || (!force && this.data && (this.current !== 'all' || this.frames.length || this.panel.open || this.expanded.open))) return;
        this.loading = true; this.refresh.disabled = true;
        const token = ++this.sequence;
        try {
            const data = await this.request();
            if (token !== this.sequence) return;
            if (!data.snapshot) {
                this.message.textContent = 'No completed account-type snapshot yet.';
                return;
            }
            this.data = data;
            this.nodes = new Map(data.nodes.map(n => [n.id, n]));
            this.current = 'all'; this.frames = []; this.cache.clear();
            this.time.textContent = `Latest · ${timestamp(data.snapshot.finishedAt)}`;
            this.time.title = `Observation: ${data.snapshot.startedAt} – ${data.snapshot.finishedAt}\nPublished: ${data.snapshot.publishedAt}\nIndependent of the selected time range.`;
            await this.draw();
        } catch (error) {
            this.message.replaceChildren(el('span', '', `Account types unavailable. ${error.message} `), button('Retry', () => this.load(true)));
        } finally {
            this.loading = false; this.refresh.disabled = false;
        }
    }

    toggleExpanded() {
        this.tooltip.hidden = true;
        if (this.expanded.open) {
            this.expanded.close();
            this.container.append(this.card);
            this.expand.textContent = '⛶'; this.expand.setAttribute('aria-label', 'Expand account types');
        } else {
            this.expanded.append(this.card);
            this.expand.textContent = '×'; this.expand.setAttribute('aria-label', 'Close expanded account types');
            this.expanded.showModal(); this.expand.focus();
        }
    }

    path(id) {
        const result = [];
        for (let node = this.nodes.get(id); node; node = this.nodes.get(node.parent)) result.unshift(node);
        return result;
    }

    navigate(id, frame = null) {
        this.current = id;
        if (frame) this.frames.push(frame);
        else this.frames = [];
        this.draw(true);
    }

    async members(node, offset = 0, limit = 8, search = '') {
        const key = [node, offset, limit, search].join('|');
        if (this.cache.has(key)) return this.cache.get(key);
        const publication = this.data.snapshot.publicationId;
        const result = await this.request({ publication, node, offset, limit, ...(search ? { search } : {}) });
        if (publication === this.data.snapshot.publicationId) {
            if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value);
            this.cache.set(key, result);
        }
        return result;
    }

    async draw(focus = false) {
        const token = ++this.sequence;
        const node = this.nodes.get(this.current);
        if (!node) return;
        this.tooltip.hidden = true;
        this.breadcrumbs.replaceChildren();
        for (const part of this.path(node.id)) {
            this.breadcrumbs.append(button(part.id === 'all' ? 'All' : part.label, () => this.navigate(part.id)));
        }
        this.frames.forEach((_, i) => this.breadcrumbs.append(button('Remaining', () => {
            this.frames = this.frames.slice(0, i + 1); this.draw(true);
        })));
        const frame = this.frames.at(-1);
        const total = frame?.accounts ?? node.accounts;
        const children = frame?.children ?? typeChildren(this.data.nodes, node.id);
        this.message.textContent = '';
        this.body.replaceChildren();
        try {
            let rows, remainderAction;
            if (children.length) {
                rows = children;
                remainderAction = (remaining, tail) => this.navigate(node.id, { accounts: remaining, children: tail });
            } else {
                this.message.textContent = 'Loading code hashes…';
                const offset = frame?.offset ?? 0;
                const result = await this.members(node.id, offset);
                if (token !== this.sequence) return;
                rows = result.rows.map(row => ({ ...row, label: `${row.codeHashHex.slice(0, 8)}…${row.codeHashHex.slice(-6)}` }));
                remainderAction = remaining => this.navigate(node.id, { accounts: remaining, offset: offset + rows.length });
            }
            if (token !== this.sequence) return;
            const { visible, remainder } = partitionTypes(rows, total);
            const sectors = visible.map(row => ({ ...row, activate: () => row.codeHash ? this.showDetail(row.codeHash) : this.navigate(row.id) }));
            if (BigInt(remainder) > 0n) sectors.push({ label: 'Remaining', id: 'remaining', accounts: remainder, activate: () => remainderAction(remainder, rows.slice(8)) });
            this.renderRing(sectors, total);
            this.message.textContent = '';
            this.body.append(button(`Browse all code hashes (${integer(node.hashes)})`,
                () => this.showList(node.id), 'type-browse'));
            if (focus) this.breadcrumbs.lastElementChild?.focus();
        } catch (error) {
            if (token === this.sequence) this.message.replaceChildren(el('span', '', `${error.message} `), button('Retry', () => this.draw()));
        }
    }

    renderRing(rows, total) {
        const ring = svg('svg', { viewBox: '0 0 260 260', role: 'group', 'aria-label': 'Account type distribution' });
        ring.classList.add('type-ring');
        const chart = el('div', 'type-ring-wrap');
        const center = el('div', 'type-center');
        center.append(el('strong', '', compactAccounts(total)), el('span', '', 'accounts'));
        center.title = integer(total);
        chart.append(ring, center);
        const legend = el('div', 'type-legend');
        let angle = -Math.PI / 2;
        for (const row of rows) {
            const share = Number(BigInt(row.accounts) * 1000000000000n / BigInt(total)) / 1000000000000;
            const length = share * Math.PI * 2;
            const fill = row.id === 'remaining' ? '#a6adb6' : color(row);
            const path = svg('path', { d: sector(angle, length), fill, role: 'button', tabindex: '0',
                'aria-label': `${row.label}: ${integer(row.accounts)} accounts, ${typePercent(row.accounts, total)}. Open.` });
            angle += length;
            const line = button('', row.activate, 'type-legend-row');
            const dot = el('span', 'type-dot'); dot.style.background = fill;
            line.append(dot, el('span', 'type-label', row.label), el('span', 'type-share', typePercent(row.accounts, total)));
            const describe = () => {
                this.tooltip.replaceChildren(el('strong', '', row.label),
                    el('div', '', `${integer(row.accounts)} accounts`),
                    el('div', '', `${typePercent(row.accounts, total)} of this view · ${typePercent(row.accounts, this.data.snapshot.indexedAccounts)} of all`));
                if (row.known !== undefined) {
                    this.tooltip.append(el('div', '', `Known code: ${integer(row.known)} · By get methods: ${integer(row.inferred)}`));
                }
                this.tooltip.hidden = false;
                path.classList.add('highlight'); line.classList.add('highlight');
            };
            const hide = () => { this.tooltip.hidden = true; path.classList.remove('highlight'); line.classList.remove('highlight'); };
            for (const target of [path, line]) {
                target.addEventListener('pointerenter', describe); target.addEventListener('pointerleave', hide);
                target.addEventListener('focus', describe); target.addEventListener('blur', hide);
            }
            path.addEventListener('click', row.activate);
            path.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.activate(); }
            });
            ring.append(path); legend.append(line);
        }
        this.body.append(chart, legend);
    }

    panelHeader(title, back) {
        const heading = el('div', 'type-panel-heading');
        const h = el('h2', '', title); h.id = 'type-panel-title';
        if (back) heading.append(button('‹ Back', back, 'type-back'));
        const close = button('×', () => this.panel.close(), 'type-icon');
        close.setAttribute('aria-label', 'Close account type details');
        heading.append(h, close);
        this.panel.replaceChildren(heading);
        if (!this.panel.open) this.panel.showModal();
    }

    showList(node, offset = 0) {
        this.listState = { node, offset, search: '' };
        this.renderList();
    }

    async renderList() {
        const state = this.listState, token = ++this.panelSequence;
        this.panelHeader('Code hashes');
        const input = el('input', 'type-search'); input.type = 'search'; input.placeholder = 'Search hex or base64 hash';
        input.setAttribute('aria-label', 'Search code hashes'); input.value = state.search;
        const results = el('div', 'type-hash-results', 'Loading…');
        let timeout;
        input.oninput = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (!this.panel.open || token !== this.panelSequence) return;
                state.search = input.value.trim(); state.offset = 0; this.renderList();
            }, 350);
        };
        this.panel.append(el('p', 'type-panel-path', this.path(state.node).map(n => n.label).join(' › ')), input, results);
        if (state.search) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
        try {
            const data = await this.members(state.node, state.offset, 100, state.search);
            if (token !== this.panelSequence) return;
            results.replaceChildren(el('p', 'type-metadata', `${integer(data.matchedHashes)} code hashes · ${integer(data.matchedAccounts)} accounts`));
            const table = el('table', 'type-hash-table');
            const head = el('tr'); head.append(el('th', '', 'Code hash'), el('th', '', 'Accounts'));
            const thead = el('thead'); thead.append(head); table.append(thead);
            const body = el('tbody');
            for (const row of data.rows) {
                const tr = el('tr'), hash = el('td'), count = el('td', '', integer(row.accounts));
                hash.append(button(row.codeHashHex, () => this.showDetail(row.codeHash), 'type-hash-link'));
                tr.append(hash, count); body.append(tr);
            }
            table.append(body); results.append(table);
            if (!data.rows.length) results.append(el('p', '', 'No matching code hashes.'));
            const navigation = el('div', 'type-pagination');
            const previous = button('Previous', () => { state.offset = Math.max(0, state.offset - 100); this.renderList(); });
            const next = button('Next', () => { state.offset += 100; this.renderList(); });
            previous.disabled = state.offset === 0;
            next.disabled = BigInt(state.offset + data.rows.length) >= BigInt(data.matchedHashes);
            navigation.append(previous, el('span', '', `From ${integer(state.offset + (data.rows.length ? 1 : 0))}`), next);
            results.append(navigation);
        } catch (error) {
            if (token === this.panelSequence) results.textContent = error.message;
        }
    }

    async showDetail(hash) {
        const token = ++this.panelSequence;
        this.tooltip.hidden = true;
        this.panelHeader('Implementation', this.listState ? () => this.renderList() : null);
        const content = el('div', 'type-detail', 'Loading…'); this.panel.append(content);
        try {
            const data = await this.request({ publication: this.data.snapshot.publicationId, hash });
            if (token !== this.panelSequence) return;
            const d = data.detail;
            if (!d) { content.textContent = 'Code hash is not in this snapshot.'; return; }
            const leaf = this.nodes.get(d.leaf);
            content.replaceChildren(el('p', 'type-panel-path', this.path(d.leaf).map(n => n.label).join(' › ')),
                el('p', 'type-detail-count', `${integer(d.accounts)} accounts · ${typePercent(d.accounts, this.data.snapshot.indexedAccounts)} of all`));
            for (const [name, value] of [['Hex', d.codeHashHex], ['Base64', d.codeHash]]) {
                const block = el('div', 'type-code');
                const copy = button('Copy', async () => {
                    try { await navigator.clipboard.writeText(value); copy.textContent = 'Copied'; }
                    catch { copy.textContent = 'Select to copy'; }
                });
                block.append(el('span', 'type-metadata', name), el('code', '', value), copy); content.append(block);
            }
            content.append(el('h3', '', 'Why this classification'));
            const explanation = leaf?.evidence === 'code_hash'
                ? 'Exact code-hash match with the pinned TON ABI Catalog, classified using reviewed implementation rules. Project membership is not established by code alone.'
                : leaf?.evidence === 'get_methods'
                    ? 'Inferred from standard getter IDs in the static dispatcher. Getter execution, return types and per-account state have not been verified.'
                    : d.methodsAvailable ? 'Static methods are available, but no supported interface rule matched.' : 'No static method record is available. This does not prove that getters are absent.';
            content.append(el('p', '', explanation));
            if (leaf?.roles?.length) content.append(el('p', '', `Roles: ${leaf.roles.join(' + ')}`));
            const ids = new Set(d.methods.map(m => m.id));
            const traits = [];
            if (ids.has(102351) && ids.has(84760) && ids.has(97667)) traits.push('SBT-like getters');
            if (ids.has(123660)) traits.push('DNS resolver getter');
            if (traits.length) content.append(el('p', '', `Additional static traits: ${traits.join(', ')}`));
            content.append(el('h3', '', 'Detected statically'));
            if (!d.methodsAvailable) content.append(el('p', '', 'No method record.'));
            else {
                const list = el('ul', 'type-methods');
                for (const method of d.methods) {
                    const declared = [...new Set(d.contracts.flatMap(c => c.methods.filter(m => m.id === method.id).map(m => m.name)))];
                    const names = declared.length ? declared : method.names;
                    list.append(el('li', '', `${method.id} · ${names.length ? names.join(' / ') : 'Unknown method ID'}${!declared.length && names.length ? ' (possible name)' : ''}`));
                }
                content.append(list, el('p', 'type-metadata', 'The dispatcher list can be incomplete and can include entry points and helper functions. A numeric ID alone does not establish a signature.'));
            }
            content.append(el('h3', '', 'Declared in ABI'));
            if (!d.contracts.length) content.append(el('p', '', 'This code hash has no ABI catalog entry.'));
            for (const contract of d.contracts) {
                const section = el('details', 'type-abi'); section.open = d.contracts.length === 1;
                section.append(el('summary', '', contract.name), el('p', 'type-metadata', contract.id));
                for (const method of contract.methods) {
                    const block = el('div', 'type-abi-method');
                    block.append(el('code', '', `${method.name}(${method.parameters.map(p => `${p.name}: ${p.type}`).join(', ')}) → ${method.return}`),
                        el('span', 'type-metadata', `ID ${method.id} · ${ids.has(method.id) ? 'also detected statically' : 'ABI declaration'}`));
                    if (method.description) block.append(el('p', '', method.description));
                    if (method.unsupported) block.append(el('p', 'type-metadata', `Decoder: ${method.unsupported}`));
                    section.append(block);
                }
                const links = el('div', 'type-source-links');
                for (const source of contract.links) {
                    let url;
                    try { url = new URL(source.url); } catch { continue; }
                    if (!['https:', 'http:'].includes(url.protocol)) continue;
                    const link = el('a', '', source.title); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.append(link);
                }
                section.append(links); content.append(section);
            }
            const link = el('a', '', 'TON ABI Catalog v0.1.3');
            link.href = 'https://github.com/ton-blockchain/abis/releases/tag/v0.1.3'; link.target = '_blank'; link.rel = 'noopener noreferrer';
            content.append(link, el('p', 'type-metadata', `ABI SHA-256: ${this.data.snapshot.abiRevision}`),
                el('p', 'type-metadata', `Classification: ${this.data.snapshot.classificationVersion}`),
                el('p', 'type-metadata', `Static metadata observed: ${d.methodsStartedAt} – ${d.methodsFinishedAt}`));
        } catch (error) {
            if (token === this.panelSequence) content.textContent = error.message;
        }
    }
}
