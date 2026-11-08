const SVG_NS = 'http://www.w3.org/2000/svg';
const exactNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
let nextChartId = 0;

export function formatValue(value, unit = '') {
    if (!Number.isFinite(value)) return 'No reading';
    return `${exactNumber.format(value)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}

export function formatSummary(value, unit = '') {
    if (!Number.isFinite(value)) return '—';
    if (unit === '%') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
    return Math.abs(value) >= 100000
        ? compactNumber.format(value)
        : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

export function formatDate(date) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...(date.length > 10 ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).format(new Date(date));
}

export function sumReadings(values) {
    if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
    // Avoid exposing binary floating-point tails in stacked demo totals.
    const decimals = Math.max(...values.map((value) => (String(value).split('.')[1] || '').length));
    return Number(values.reduce((sum, value) => sum + value, 0).toFixed(Math.min(decimals, 15)));
}

export function buildRows(dates, series) {
    const lookups = series.map((item) => new Map(item.points));
    return dates.map((date) => {
        const values = lookups.map((lookup) => {
            const value = lookup.get(date);
            return Number.isFinite(value) ? value : null;
        });
        return { date, values, total: sumReadings(values) };
    });
}

function node(tag, attrs = {}, text) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
}

function html(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function demoMark() {
    const mark = html('span', 'demo-mark', '*');
    mark.setAttribute('aria-label', 'Demo data');
    return mark;
}

function contiguous(rows, valid) {
    const segments = [];
    let segment = [];
    rows.forEach((row, index) => {
        if (valid(row)) segment.push({ ...row, index });
        else if (segment.length) {
            segments.push(segment);
            segment = [];
        }
    });
    if (segment.length) segments.push(segment);
    return segments;
}

function niceCeiling(value) {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const fraction = value / power;
    const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= fraction) || 10;
    return step * power;
}

function domain(config, rows) {
    if (config.share) return [0, 100];
    const stacked = config.kind.startsWith('stacked');
    const values = rows.flatMap((row) =>
        stacked ? (row.total === null ? [] : [row.total]) : row.values.filter(Number.isFinite),
    );
    if (!values.length) return [0, 1];
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    if (config.zero) return [0, niceCeiling(((maximum || 1) * 1.08) / 2) * 2];
    const padding = (maximum - minimum || Math.abs(maximum) * 0.02 || 1) * 0.18;
    let lower = Math.max(0, minimum - padding);
    let upper = maximum + padding;
    if (config.integer) {
        lower = Math.max(0, Math.floor(lower));
        upper = Math.ceil(upper);
    }
    return [lower, upper];
}

function axisNumber(value, range, unit) {
    const absolute = Math.abs(value);
    const divisor = absolute >= 1e9 ? 1e9 : absolute >= 1e6 ? 1e6 : absolute >= 1e3 ? 1e3 : 1;
    const suffix = divisor === 1e9 ? 'B' : divisor === 1e6 ? 'M' : divisor === 1e3 ? 'K' : '';
    const digits = Math.max(0, Math.min(6, Math.ceil(Math.log10(divisor / (range / 2 || 1))) + 1));
    const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value / divisor);
    return `${number}${suffix}${unit === '%' ? '%' : ''}`;
}

/** One accessible, dependency-free SVG plot. Dates with no reading stay gaps. */
export class TimeChart {
    constructor(surface, config, dates) {
        this.surface = surface;
        this.id = `plot-${++nextChartId}`;
        this.focused = false;
        this.pinned = false;
        this.svg = node('svg', { class: 'chart-svg', 'aria-hidden': 'true' });
        this.tooltip = html('div', 'chart-tooltip');
        this.tooltip.id = `${this.id}-tooltip`;
        this.tooltip.hidden = true;
        this.tooltip.setAttribute('role', 'status');
        this.tooltip.setAttribute('aria-live', 'polite');
        this.tooltip.setAttribute('aria-atomic', 'true');
        surface.append(this.svg, this.tooltip);
        surface.tabIndex = 0;
        surface.setAttribute('role', 'group');
        surface.setAttribute('aria-roledescription', 'interactive chart');
        surface.setAttribute('aria-describedby', 'chart-help');

        this.onMove = (event) => {
            if (event.pointerType !== 'touch') this.showAtPointer(event);
        };
        this.onDown = (event) => {
            this.pinned = event.pointerType === 'touch' || event.pointerType === 'pen';
            this.showAtPointer(event);
        };
        this.onLeave = () => {
            if (!this.focused && !this.pinned) this.hide();
        };
        this.onFocus = () => {
            this.focused = true;
            this.show(this.selectedIndex);
        };
        this.onBlur = () => {
            this.focused = false;
            if (!this.pinned) this.hide();
        };
        this.onKey = (event) => {
            const actions = {
                ArrowLeft: this.selectedIndex - 1,
                ArrowRight: this.selectedIndex + 1,
                Home: 0,
                End: this.rows.length - 1,
            };
            if (event.key === 'Escape') {
                this.pinned = false;
                this.hide();
                event.preventDefault();
            } else if (Object.hasOwn(actions, event.key)) {
                event.preventDefault();
                this.show(actions[event.key]);
            }
        };
        this.onOutside = (event) => {
            if (!surface.contains(event.target) && this.pinned) {
                this.pinned = false;
                this.hide();
            }
        };
        surface.addEventListener('pointermove', this.onMove);
        surface.addEventListener('pointerdown', this.onDown);
        surface.addEventListener('pointerleave', this.onLeave);
        surface.addEventListener('focus', this.onFocus);
        surface.addEventListener('blur', this.onBlur);
        surface.addEventListener('keydown', this.onKey);
        document.addEventListener('pointerdown', this.onOutside);
        this.update(config, dates);
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.draw());
            this.observer.observe(surface);
        } else {
            this.onResize = () => this.draw();
            window.addEventListener('resize', this.onResize);
        }
    }

    update(config, dates) {
        this.config = config;
        this.rows = buildRows(dates, config.series);
        this.selectedIndex = this.rows.findLastIndex((row) => row.values.some(Number.isFinite));
        if (this.selectedIndex < 0) this.selectedIndex = this.rows.length - 1;
        this.surface.setAttribute(
            'aria-label',
            `${config.title}${config.series.some((item) => item.demo) ? ', includes demo data' : ''}. ${formatDate(dates[0])} to ${formatDate(dates.at(-1))}.`,
        );
        this.hide();
        this.draw();
    }

    draw() {
        const width = this.surface.clientWidth || 480;
        const height = this.surface.clientHeight || 273;
        const left = 80;
        const right = width - 24;
        const top = 27;
        const bottom = height - 41;
        const [minimum, maximum] = domain(this.config, this.rows);
        const timestamps = this.rows.map((r) => Date.parse(r.date));
        const span = timestamps.at(-1) - timestamps[0];
        const x = (index) =>
            this.config.round && span > 0
                ? left + 8 + ((timestamps[index] - timestamps[0]) / span) * (right - left - 16)
                : left + ((index + 0.5) / this.rows.length) * (right - left);
        const y = (value) => bottom - ((value - minimum) / (maximum - minimum)) * (bottom - top);
        this.geometry = { width, height, left, right, top, bottom, x, y };
        this.svg.replaceChildren();
        this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const hasReadings = this.rows.some((row) => row.values.some(Number.isFinite));
        if (hasReadings) {
            const ticks = [minimum, (minimum + maximum) / 2, maximum];
            for (let value of ticks) {
                if (this.config.integer) value = Math.round(value);
                this.svg.append(node('line', { x1: left, x2: right, y1: y(value), y2: y(value), class: 'grid-line' }));
                this.svg.append(
                    node(
                        'text',
                        { x: left - 9, y: y(value) + 3, 'text-anchor': 'end', class: 'axis-label' },
                        axisNumber(value, maximum - minimum, this.config.unit),
                    ),
                );
            }
        }
        const tickIndices = [0, Math.floor((this.rows.length - 1) / 2), this.rows.length - 1];
        for (const index of tickIndices) {
            this.svg.append(
                node(
                    'text',
                    { x: x(index), y: height - 13, 'text-anchor': 'middle', class: 'axis-label' },
                    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
                        new Date(this.rows[index].date),
                    ),
                ),
            );
        }
        if (!hasReadings) {
            this.svg.append(
                node(
                    'text',
                    { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'chart-empty' },
                    this.config.loading ? 'Loading readings…' : 'No readings in this period',
                ),
            );
        } else if (this.config.kind.includes('bar')) this.drawBars();
        else if (this.config.kind === 'stacked-area') this.drawStack();
        else this.drawLines();

        this.selection = node('g', { visibility: 'hidden' });
        this.svg.append(this.selection);
        if (!this.tooltip.hidden) this.show(this.selectedIndex);
    }

    drawBars() {
        const { x, y, left, right, bottom } = this.geometry;
        const stacked = this.config.kind === 'stacked-bar';
        const width = Math.max(2, ((right - left) / this.rows.length) * 0.68);
        this.rows.forEach((row, index) => {
            if (stacked && row.total === null) return;
            let base = 0;
            this.config.series.forEach((item, seriesIndex) => {
                const value = row.values[seriesIndex];
                if (value === null) return;
                const upper = stacked ? base + value : value;
                const lower = stacked ? y(base) : bottom;
                this.svg.append(
                    node('rect', {
                        x: x(index) - width / 2,
                        y: y(upper),
                        width,
                        height: Math.max(0, lower - y(upper)),
                        fill: item.color,
                        'fill-opacity': 0.83,
                        rx: 0.8,
                    }),
                );
                base = upper;
            });
        });
    }

    drawLines() {
        const { x, y, bottom } = this.geometry;
        this.config.series.forEach((item, seriesIndex) => {
            const segments = contiguous(this.rows, (row) => row.values[seriesIndex] !== null);
            for (const segment of segments) {
                const path = segment
                    .map((row, i) =>
                        i && this.config.kind === 'step'
                            ? `H${x(row.index)}V${y(row.values[seriesIndex])}`
                            : `${i ? 'L' : 'M'}${x(row.index)},${y(row.values[seriesIndex])}`,
                    )
                    .join(' ');
                if (segment.length > 1 && this.config.kind !== 'dot') {
                    if (this.config.fill && seriesIndex === 0) {
                        this.svg.append(
                            node('path', {
                                d: `${path} L${x(segment.at(-1).index)},${bottom} L${x(segment[0].index)},${bottom} Z`,
                                fill: item.color,
                                'fill-opacity': 0.07,
                            }),
                        );
                    }
                    this.svg.append(node('path', { d: path, class: 'series-line', stroke: item.color }));
                }
                const dots = segment.length === 1 || this.config.kind === 'dot' ? segment : [segment.at(-1)];
                for (const row of dots) {
                    const single = segment.length === 1 || this.config.kind === 'dot';
                    if (single)
                        this.svg.append(
                            node('circle', {
                                cx: x(row.index),
                                cy: y(row.values[seriesIndex]),
                                r: 7,
                                fill: item.color,
                                'fill-opacity': 0.12,
                            }),
                        );
                    this.svg.append(
                        node('circle', {
                            cx: x(row.index),
                            cy: y(row.values[seriesIndex]),
                            r: single ? 3.5 : 2.2,
                            fill: item.color,
                        }),
                    );
                }
            }
        });
    }

    drawStack() {
        const { x, y } = this.geometry;
        const segments = contiguous(this.rows, (row) => row.total !== null);
        this.config.series.forEach((item, seriesIndex) => {
            for (const segment of segments) {
                const upper = segment.map((row) => [
                    x(row.index),
                    y(sumReadings(row.values.slice(0, seriesIndex + 1))),
                ]);
                const lower = segment.map((row) => [
                    x(row.index),
                    y(seriesIndex === 0 ? 0 : sumReadings(row.values.slice(0, seriesIndex))),
                ]);
                const line = upper.map((point, i) => `${i ? 'L' : 'M'}${point.join(',')}`).join(' ');
                const base = lower
                    .reverse()
                    .map((point) => `L${point.join(',')}`)
                    .join(' ');
                this.svg.append(node('path', { d: `${line} ${base} Z`, fill: item.color, 'fill-opacity': 0.24 }));
                this.svg.append(
                    node('path', { d: line, stroke: item.color, class: 'series-line', 'stroke-width': 1.2 }),
                );
            }
        });
    }

    showAtPointer(event) {
        const { left, right } = this.geometry;
        const position = event.clientX - this.surface.getBoundingClientRect().left;
        if (this.config.round) {
            let best = 0;
            for (let i = 1; i < this.rows.length; i++)
                if (Math.abs(this.geometry.x(i) - position) < Math.abs(this.geometry.x(best) - position)) best = i;
            this.show(best);
        } else this.show(Math.floor(((position - left) / (right - left)) * this.rows.length));
    }

    show(index) {
        this.selectedIndex = Math.max(0, Math.min(this.rows.length - 1, index));
        const row = this.rows[this.selectedIndex];
        const { x, y, top, bottom, width } = this.geometry;
        const position = x(this.selectedIndex);
        this.selection.replaceChildren(
            node('line', { x1: position, x2: position, y1: top, y2: bottom, class: 'chart-cursor' }),
        );
        this.selection.setAttribute('visibility', 'visible');
        let base = 0;
        this.config.series.forEach((item, seriesIndex) => {
            const value = row.values[seriesIndex];
            if (value === null) return;
            base = this.config.kind.startsWith('stacked') ? base + value : value;
            if (!this.config.kind.includes('bar') && (!this.config.kind.startsWith('stacked') || row.total !== null)) {
                this.selection.append(
                    node('circle', {
                        cx: position,
                        cy: y(base),
                        r: 3.2,
                        fill: item.color,
                        stroke: '#fff',
                        'stroke-width': 1.5,
                    }),
                );
            }
        });

        this.tooltip.replaceChildren(html('strong', 'tooltip-date', formatDate(row.date)));
        this.config.series.forEach((item, seriesIndex) => {
            const entry = html('div', 'tooltip-row');
            const label = html('span', 'tooltip-label');
            const swatch = html('span', 'swatch');
            swatch.style.setProperty('--series-color', item.color);
            label.append(swatch, document.createTextNode(item.label));
            if (item.demo) label.append(demoMark());
            const exact = item.exact?.[row.date];
            entry.append(
                label,
                html(
                    'span',
                    'tooltip-value',
                    exact != null
                        ? `${exact} ${this.config.unit}`
                        : formatValue(row.values[seriesIndex], this.config.unit),
                ),
            );
            this.tooltip.append(entry);
        });
        if (this.config.kind.startsWith('stacked')) {
            const total = html('div', 'tooltip-row tooltip-total');
            total.append(
                html('span', '', 'Total'),
                html('span', 'tooltip-value', formatValue(row.total, this.config.unit)),
            );
            this.tooltip.append(total);
        }
        if (this.config.note) this.tooltip.append(html('p', 'tooltip-note', this.config.note));
        const detail = this.config.series.find((s) => s.details?.[row.date])?.details[row.date];
        if (detail) this.tooltip.append(html('p', 'tooltip-note', detail));
        this.tooltip.hidden = false;
        const tooltipWidth = this.tooltip.offsetWidth;
        const tooltipHeight = this.tooltip.offsetHeight;
        const preferred = position > width / 2 ? position - tooltipWidth - 12 : position + 12;
        this.tooltip.style.left = `${Math.max(8, Math.min(width - tooltipWidth - 8, preferred))}px`;
        this.tooltip.style.top = `${Math.max(8, Math.min(15, this.surface.clientHeight - tooltipHeight - 8))}px`;
    }

    hide() {
        this.tooltip.hidden = true;
        if (this.selection) this.selection.setAttribute('visibility', 'hidden');
    }

    destroy() {
        this.observer?.disconnect();
        if (this.onResize) window.removeEventListener('resize', this.onResize);
        this.surface.removeEventListener('pointermove', this.onMove);
        this.surface.removeEventListener('pointerdown', this.onDown);
        this.surface.removeEventListener('pointerleave', this.onLeave);
        this.surface.removeEventListener('focus', this.onFocus);
        this.surface.removeEventListener('blur', this.onBlur);
        this.surface.removeEventListener('keydown', this.onKey);
        document.removeEventListener('pointerdown', this.onOutside);
    }
}
