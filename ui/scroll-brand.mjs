// The real H1 stays in the document. Its visual copy animates as independent
// glyph groups, so abbreviation never changes layout or clips half-words.
const masthead = document.querySelector('.masthead');
const title = masthead.querySelector('h1');
const icon = masthead.querySelector('.masthead-logo');
const controls = document.querySelector('.time-controls');
const dock = controls.querySelector('.brand-dock');

const brand = document.createElement('div');
brand.className = 'scroll-brand';
brand.setAttribute('aria-hidden', 'true');
brand.style.visibility = 'hidden';
const mark = icon.cloneNode();
brand.append(mark);
document.body.append(brand);

const compact = 'TON Stats';
// Source spans, then their destinations in the compact wordmark. The long
// pieces slide left and fade; the surviving letters move continuously.
const parts = [
    { text: 'T', from: [0, 1], to: [0, 1] },
    { text: 'he ', from: [1, 4] },
    { text: 'O', from: [4, 5], to: [1, 2] },
    { text: 'pen ', from: [5, 9] },
    { text: 'N', from: [9, 10], to: [2, 3] },
    { text: 'etwork ', from: [10, 17] },
    { text: 'Stat', from: [17, 21], to: [4, 8] },
    { text: 'istics', from: [21, 27] },
    { text: 's', to: [8, 9], incoming: true },
].map(part => {
    const node = document.createElement('span');
    node.className = 'scroll-brand-part';
    node.textContent = part.text;
    brand.append(node);
    return { ...part, node };
});

let geometry;
let shownProgress;
let frame = 0;
let previousFrame = 0;
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);

function measure() {
    // If the copy changes, leave the original heading visible instead of
    // showing a stale abbreviation.
    if (title.textContent !== 'The Open Network Statistics') return;
    const titleRect = title.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const sourceText = title.firstChild;
    const probe = document.createElement('span');
    probe.className = 'scroll-brand-probe';
    probe.textContent = compact;
    brand.append(probe);
    const probeRect = probe.getBoundingClientRect();
    const range = document.createRange();
    const pieceRect = (node, bounds) => {
        range.setStart(node, bounds[0]);
        range.setEnd(node, bounds[1]);
        return range.getBoundingClientRect();
    };
    const gap = innerWidth <= 680 ? 14 : 12;
    const scale = innerWidth <= 680 ? 0.55 : 0.7;
    const compactTop = (titleRect.height - probeRect.height) / 2;
    for (const part of parts) {
        const from = part.from ? pieceRect(sourceText, part.from) : pieceRect(sourceText, [21, 27]);
        const to = part.to ? pieceRect(probe.firstChild, part.to) : null;
        part.startX = from.left - iconRect.left;
        part.startY = from.top - titleRect.top;
        part.endX = to ? iconRect.width + gap + to.left - probeRect.left : part.startX - 30;
        part.endY = to ? compactTop + to.top - probeRect.top : part.startY - 4;
    }
    // The new final 's' emerges beside 'Stat', not at its eventual location.
    const stat = parts.find(part => part.text === 'Stat');
    const statWidth = pieceRect(sourceText, stat.from).width;
    const incoming = parts.at(-1);
    incoming.startX = stat.startX + statWidth;
    incoming.startY = stat.startY;
    probe.remove();
    geometry = {
        x: iconRect.left,
        start: scrollY + titleRect.top,
        end: scrollY + masthead.getBoundingClientRect().bottom + parseFloat(getComputedStyle(controls).marginTop),
        height: titleRect.height,
        iconY: iconRect.top - titleRect.top,
        scale,
    };
    brand.style.width = `${iconRect.width + gap + titleRect.width}px`;
    brand.style.height = `${titleRect.height}px`;
    mark.style.top = `${geometry.iconY}px`;
    dock.style.width = `${Math.ceil((iconRect.width + gap + probeRect.width) * scale)}px`;
    schedule();
}

function render(progress) {
    const { x, start, end, height, scale: compactScale } = geometry;
    const t = ease(progress);
    const size = 1 - (1 - compactScale) * t;
    const dockRect = dock.getBoundingClientRect();
    const dockY = dockRect.top + (dockRect.height - height * compactScale) / 2;
    const edgeY = scrollY < start ? start - scrollY : Math.min(8, scrollY - start);
    const settle = clamp((progress - 0.8) / 0.2);
    const y = edgeY + (dockY - edgeY) * settle;
    const left = x + (dockRect.left - x) * t;
    brand.style.transform = `translate3d(${left}px, ${y}px, 0) scale(${size})`;
    brand.style.opacity = dockRect.bottom <= 0 ? '0' : '1';
    for (const part of parts) {
        const px = part.startX + (part.endX - part.startX) * t;
        const py = part.startY + (part.endY - part.startY) * t;
        part.node.style.transform = `translate3d(${px}px, ${py}px, 0)`;
        part.node.style.opacity = part.incoming ? String(clamp((progress - 0.35) / 0.35))
            : part.to ? '1' : String(1 - clamp(progress / 0.55));
    }
    brand.style.visibility = 'visible';
    masthead.classList.add('brand-animated');
}

function tick(now) {
    frame = 0;
    if (!geometry) return;
    const target = clamp((scrollY - geometry.start) / Math.max(1, geometry.end - geometry.start));
    if (shownProgress === undefined) shownProgress = target;
    else {
        // A wheel event can arrive after a long idle period. Don't treat that
        // idle time as animation time or the first frame will jump halfway.
        const elapsed = Math.min(24, now - (previousFrame || now));
        shownProgress += (target - shownProgress) * (1 - Math.exp(-elapsed / 175));
        if (Math.abs(target - shownProgress) < 0.001) shownProgress = target;
    }
    previousFrame = now;
    render(shownProgress);
    if (shownProgress !== target) schedule();
}

function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
}
addEventListener('scroll', schedule, { passive: true });
addEventListener('resize', measure);
document.fonts.ready.then(measure);
measure();
