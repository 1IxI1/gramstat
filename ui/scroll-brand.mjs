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
const parked = document.createElement('span');
parked.className = 'brand-parked';
parked.setAttribute('aria-hidden', 'true');
parked.append(icon.cloneNode(), document.createTextNode(compact));
dock.append(parked);
const scrollLinked = CSS.supports('animation-timeline', 'scroll(root block)') && CSS.supports('animation-range', '30px 110px');
const timelineStyles = scrollLinked ? document.head.appendChild(document.createElement('style')) : null;
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
let frame = 0;
const clamp = value => Math.max(0, Math.min(1, value));

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
    const dockRect = dock.getBoundingClientRect();
    const dockY = dockRect.top - controls.getBoundingClientRect().top + (dockRect.height - titleRect.height * scale) / 2;
    const titleY = scrollY + titleRect.top;
    geometry = {
        x: iconRect.left,
        titleY,
        dockY,
        // Start when the original heading reaches its final viewport height.
        start: titleY - dockY,
        end: scrollY + masthead.getBoundingClientRect().bottom + parseFloat(getComputedStyle(controls).marginTop),
        height: titleRect.height,
        iconY: iconRect.top - titleRect.top,
        scale,
    };
    brand.style.width = `${iconRect.width + gap + titleRect.width}px`;
    brand.style.height = `${titleRect.height}px`;
    mark.style.top = `${geometry.iconY}px`;
    dock.style.width = `${Math.ceil((iconRect.width + gap + probeRect.width) * scale)}px`;
    if (scrollLinked) setupTimeline();
    else schedule();
}

function setupTimeline() {
    const { x, start, end, titleY, dockY, scale } = geometry;
    const dockRect = dock.getBoundingClientRect();
    const px = n => `${Number(n.toFixed(3))}px`;
    const move = (position, top, progress) => `translate3d(${px(position)},${px(top)},0) scale(${1 - (1 - scale) * progress})`;
    const position = progress => x + (dockRect.left - x) * progress;
    const percent = offset => `${Number((offset / end * 100).toFixed(5))}%`;
    const partRules = parts.map((part, i) => {
        const from = `translate3d(${px(part.startX)},${px(part.startY)},0)`;
        const to = `translate3d(${px(part.endX)},${px(part.endY)},0)`;
        const opacity = part.incoming ? '0%{opacity:0} 35%{opacity:0} 70%{opacity:1} 100%{opacity:1}'
            : part.to ? '' : '0%{opacity:1} 55%{opacity:0} 100%{opacity:0}';
        return `@keyframes scroll-brand-part-${i} {0%{transform:${from}} 100%{transform:${to}} ${opacity}}
            .scroll-brand.scroll-linked .scroll-brand-part:nth-of-type(${i + 1}) {
                animation:scroll-brand-part-${i} 1s linear both;
                animation-timeline:scroll(root block);
                animation-range:${px(start)} ${px(end)};
            }`;
    }).join('\n');
    timelineStyles.textContent = `
        @keyframes scroll-brand-move {
            0% {transform:${move(x, titleY, 0)}}
            ${percent(start)} {transform:${move(x, dockY, 0)}}
            100% {transform:${move(dockRect.left, dockY, 1)}}
        }
        @keyframes scroll-brand-hide {from{opacity:1} to{opacity:0}}
        @keyframes scroll-brand-appear {from{opacity:0} to{opacity:1}}
        .scroll-brand.scroll-linked {
            animation:scroll-brand-move 1s linear both, scroll-brand-hide 1s steps(1,end) both;
            animation-timeline:scroll(root block), scroll(root block);
            animation-range:0px ${px(end)}, 0px ${px(end)};
        }
        .brand-parked.scroll-linked {
            animation:scroll-brand-appear 1s steps(1,end) both;
            animation-timeline:scroll(root block);
            animation-range:0px ${px(end)};
        }
        ${partRules}`;
    brand.classList.add('scroll-linked');
    parked.classList.add('scroll-linked');
    brand.style.visibility = 'visible';
    masthead.classList.add('brand-animated');
}

function render(progress) {
    const { x, start, titleY, dockY, scale: compactScale } = geometry;
    const size = 1 - (1 - compactScale) * progress;
    const dockRect = dock.getBoundingClientRect();
    const y = scrollY < start ? titleY - scrollY : dockY;
    const left = x + (dockRect.left - x) * progress;
    brand.style.transform = `translate3d(${left}px, ${y}px, 0) scale(${size})`;
    brand.style.opacity = dockRect.bottom <= 0 || scrollY >= geometry.end ? '0' : '1';
    parked.style.opacity = dockRect.bottom > 0 && scrollY >= geometry.end ? '1' : '0';
    for (const part of parts) {
        const px = part.startX + (part.endX - part.startX) * progress;
        const py = part.startY + (part.endY - part.startY) * progress;
        part.node.style.transform = `translate3d(${px}px, ${py}px, 0)`;
        part.node.style.opacity = part.incoming ? String(clamp((progress - 0.35) / 0.35))
            : part.to ? '1' : String(1 - clamp(progress / 0.55));
    }
    brand.style.visibility = 'visible';
    masthead.classList.add('brand-animated');
}

function tick() {
    frame = 0;
    if (!geometry) return;
    // No time-based easing: fast and slow scrolling map to the same frame.
    render(clamp((scrollY - geometry.start) / Math.max(1, geometry.end - geometry.start)));
}

function schedule() {
    if (!frame) frame = requestAnimationFrame(tick);
}
if (!scrollLinked) addEventListener('scroll', schedule, { passive: true });
addEventListener('resize', measure);
measure();
if (document.fonts.status === 'loading') document.fonts.ready.then(measure);
