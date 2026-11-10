const SVG = 'http://www.w3.org/2000/svg';
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = code => code ? regions.of(code) : 'Unknown country';
const utc = seconds => new Date(seconds * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');

export function projectLocation(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
        || (latitude === 0 && longitude === 0)) return null;
    return [20 + (longitude + 180) * 960 / 360, 10 + (90 - latitude) * 480 / 180];
}

export function locationClusters(points) {
    const clusters = new Map();
    for (const [country, city, latitude, longitude] of points) {
        const position = projectLocation(latitude, longitude);
        if (!position) continue;
        const key = JSON.stringify([latitude, longitude]);
        if (!clusters.has(key)) clusters.set(key, { latitude, longitude, position, count: 0, places: new Map() });
        const cluster = clusters.get(key);
        const code = typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null;
        const place = JSON.stringify([code, city || null]);
        cluster.places.set(place, (cluster.places.get(place) || 0) + 1);
        cluster.count++;
    }
    // Large markers go behind small markers without moving actual coordinates.
    return [...clusters.values()].sort((a, b) => b.count - a.count);
}

function svgNode(tag, attributes) {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
}

export class ValidatorMap {
    constructor(panel) {
        this.panel = panel;
        this.svg = panel.querySelector('svg');
        this.points = panel.querySelector('.map-points');
        this.message = panel.querySelector('.map-message');
        this.summary = panel.querySelector('.map-summary');
        this.time = panel.querySelector('.map-time');
        this.countries = panel.querySelector('.map-countries');
        this.tooltip = panel.querySelector('.map-tooltip');
        this.pinned = null;
        this.svg.addEventListener('pointerover', event => {
            const point = event.target.closest('.map-point');
            if (point && !this.pinned) this.show(point);
        });
        this.svg.addEventListener('pointerleave', () => { if (!this.pinned) this.hide(); });
        this.svg.addEventListener('focusin', event => {
            const point = event.target.closest('.map-point');
            if (point) { this.pinned = null; this.show(point); }
        });
        this.svg.addEventListener('focusout', () => { if (!this.pinned) this.hide(); });
        this.svg.addEventListener('click', event => {
            const point = event.target.closest('.map-point');
            if (!point || point === this.pinned) this.hide();
            else { this.show(point); this.pinned = point; }
        });
        this.svg.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.hide();
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
        });
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') this.hide(); });
    }

    hide() {
        this.pinned = null;
        this.tooltip.hidden = true;
        this.points.querySelector('.is-active')?.classList.remove('is-active');
    }

    show(point) {
        this.hide();
        point.classList.add('is-active');
        const cluster = this.clusters[Number(point.dataset.index)];
        this.tooltip.textContent = `${point.getAttribute('aria-label')}\n${cluster.latitude.toFixed(4)}°, ${cluster.longitude.toFixed(4)}°`;
        this.tooltip.hidden = false;
    }

    status(message, loading = false) {
        this.hide();
        this.snapshot = null;
        this.panel.setAttribute('aria-busy', String(loading));
        this.points.replaceChildren();
        this.countries.replaceChildren();
        this.summary.textContent = '';
        this.time.textContent = '';
        this.message.textContent = message;
        this.message.hidden = !message;
    }

    update(snapshot, at) {
        this.status('');
        if (!snapshot) {
            this.status('No location snapshot available at this time.');
            return;
        }
        if (!Number.isInteger(snapshot.data_through) || snapshot.data_through > at + 1 || snapshot.data_through <= snapshot.utime_since) {
            this.status('No matching location snapshot at this time.');
            return;
        }
        this.clusters = locationClusters(snapshot.points);
        const located = this.clusters.reduce((sum, cluster) => sum + cluster.count, 0);
        if (!Number.isInteger(snapshot.total) || located > snapshot.total) {
            this.status('Location coverage unavailable.');
            return;
        }
        const countries = new Map();
        this.clusters.forEach((cluster, index) => {
            const places = [];
            const codes = new Set();
            for (const [key, count] of cluster.places) {
                const [country, city] = JSON.parse(key);
                countries.set(country, (countries.get(country) || 0) + count);
                codes.add(country || 'unknown');
                places.push(`${countryName(country)}${city ? ` · ${city}` : ''}: ${count}`);
            }
            const label = `${cluster.count} validator${cluster.count === 1 ? '' : 's'}\n${places.join('\n')}`;
            const point = svgNode('circle', {
                cx: cluster.position[0], cy: cluster.position[1], r: 3 + Math.min(6, Math.sqrt(cluster.count)),
                class: 'map-point', tabindex: 0, role: 'button', 'aria-label': label,
                'data-index': index, 'data-countries': [...codes].join(' '),
            });
            this.points.append(point);
        });
        const knownCountries = [...countries.keys()].filter(Boolean).length;
        this.snapshot = snapshot;
        this.summary.textContent = `${located} / ${snapshot.total} located · ${knownCountries} countries · ${snapshot.total - located} unknown${snapshot.status !== 'complete' || located < snapshot.total ? ' · partial coverage' : ''}`;
        this.time.textContent = `Snapshot: ${utc(snapshot.data_through - 1)} · Selected: ${utc(at)}`;
        this.time.title = `Round: ${utc(snapshot.utime_since)} — ${utc(snapshot.utime_until)} (exclusive end). Updated: ${snapshot.calculated_at}`;
        if (!located) {
            this.message.textContent = 'No known coordinates in this snapshot.';
            this.message.hidden = false;
        }
        for (const [country, count] of [...countries].sort((a, b) => b[1] - a[1])) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'map-country';
            button.textContent = `${countryName(country)} ${count}`;
            button.setAttribute('aria-pressed', 'false');
            button.onclick = () => {
                this.hide();
                const selected = button.getAttribute('aria-pressed') !== 'true';
                for (const item of this.countries.children) item.setAttribute('aria-pressed', String(selected && item === button));
                for (const point of this.points.children) point.classList.toggle('is-muted', selected && !point.dataset.countries.split(' ').includes(country || 'unknown'));
            };
            this.countries.append(button);
        }
    }
}
