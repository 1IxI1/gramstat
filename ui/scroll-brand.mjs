// Keep the semantic H1 in the document. A visual copy moves from its original
// position into the sticky controls as the heading scrolls out of view.
const masthead = document.querySelector('.masthead');
const title = masthead.querySelector('h1');
const icon = masthead.querySelector('.masthead-logo');
const controls = document.querySelector('.time-controls');
const dock = controls.querySelector('.brand-dock');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const brand = document.createElement('div');
brand.className = 'scroll-brand';
brand.setAttribute('aria-hidden', 'true');
brand.style.visibility = 'hidden';
const mark = icon.cloneNode();
const text = document.createElement('span');
text.className = 'scroll-brand-text';
// The visible wordmark folds its long words into T + O + N + Stats. The
// original H1 remains unchanged for screen readers and non-JS visitors.
const folds = [];
const stems = ['T', 'O', 'N', 'Stat'];
const remainders = ['he', 'pen', 'etwork', 'istics'];
const shrinkingSpaces = [];
let tail;
for (const [i, initial] of stems.entries()) {
    const word = document.createElement('span');
    word.className = 'scroll-brand-word';
    word.append(document.createTextNode(initial));
    const fold = document.createElement('span');
    fold.className = 'scroll-brand-fold';
    fold.textContent = remainders[i];
    folds.push(fold);
    word.append(fold);
    if (i === 3) {
        tail = document.createElement('span');
        tail.className = 'scroll-brand-tail';
        tail.textContent = 's';
        word.append(tail);
    }
    text.append(word);
    if (i < 3) {
        const space = document.createElement('span');
        space.className = 'scroll-brand-space';
        space.textContent = ' ';
        if (i < 2) shrinkingSpaces.push(space);
        text.append(space);
    }
}
brand.append(mark, text);
document.body.append(brand);

let frame = 0;
let brandHeight = 0;
let controlMargin = 0;
let initialized = false;
let foldWidths;
let tailWidth;
let fullFontSize;
let compactTextShift;
function measure() {
    const titleRect = title.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const compactScale = innerWidth <= 680 ? 0.55 : 0.7;
    // Word fragments have slightly different kerning from a single text node.
    // Reserve that difference so the desktop headline stays on one line.
    text.style.width = `${titleRect.width + (titleRect.height < 40 ? 8 : 0)}px`;
    text.style.height = `${titleRect.height}px`;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    brand.append(probe);
    const width = value => { probe.textContent = value; return probe.getBoundingClientRect().width; };
    foldWidths = remainders.map(width);
    const stemWidth = stems.map(width).reduce((sum, value) => sum + value, 0);
    tailWidth = width('s');
    const shortSpaceWidth = width(' ');
    probe.remove();
    fullFontSize = parseFloat(getComputedStyle(brand).fontSize);
    compactTextShift = Math.max(0, (titleRect.height - fullFontSize * 1.2) / 2);
    const gap = parseFloat(getComputedStyle(brand).gap);
    const dockWidth = Math.ceil((iconRect.width + gap + stemWidth + shortSpaceWidth + tailWidth) * compactScale);
    if (dock.style.width !== `${dockWidth}px`) dock.style.width = `${dockWidth}px`;
    brandHeight = brand.offsetHeight;
    controlMargin = parseFloat(getComputedStyle(controls).marginTop);
    schedule();
}

function update() {
    frame = 0;
    const titleRect = title.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const mastheadRect = masthead.getBoundingClientRect();
    const compactScale = innerWidth <= 680 ? 0.55 : 0.7;
    const start = scrollY + titleRect.top;
    // The sticky row reaches the viewport edge at the end of the transition.
    const end = scrollY + mastheadRect.bottom + controlMargin;
    const progress = Math.max(0, Math.min(1, (scrollY - start) / Math.max(1, end - start)));
    const t = reducedMotion.matches ? Number(progress === 1) : progress * progress * (3 - 2 * progress);
    const scale = 1 - t * (1 - compactScale);
    const dockRect = dock.getBoundingClientRect();
    const x = iconRect.left + (dockRect.left - iconRect.left) * t;
    // The title stays at the top edge while shrinking; only at the end does
    // it settle vertically into the sticky row beside the page tabs.
    const dockY = dockRect.top + (dockRect.height - brandHeight * compactScale) / 2;
    const settle = Math.max(0, Math.min(1, (progress - 0.8) / 0.2));
    const y = progress > 0 ? 8 + (dockY - 8) * settle : titleRect.top;
    brand.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    // Fade the long letter tails before folding them away, so none of the
    // intermediate frames show clipped half-words or lose the visible title.
    const fade = reducedMotion.matches ? Number(progress === 1) : Math.min(1, progress / 0.2);
    const blend = reducedMotion.matches ? fade : Math.max(0, Math.min(1, (progress - 0.15) / 0.15));
    for (const [i, fold] of folds.entries()) {
        fold.style.width = `${foldWidths[i] * (1 - blend)}px`;
        fold.style.opacity = String(1 - fade);
    }
    for (const space of shrinkingSpaces) space.style.fontSize = `${fullFontSize * (1 - blend)}px`;
    tail.style.width = `${tailWidth * blend}px`;
    text.style.transform = `translateY(${compactTextShift * blend}px)`;
    brand.style.opacity = dockRect.bottom <= 0 ? '0' : '1';
    brand.style.visibility = 'visible';
    masthead.classList.add('brand-animated');
    // First paint at the real heading position. Later scroll jumps can cross
    // the entire threshold in one wheel event; CSS interpolates that jump.
    if (!initialized) {
        initialized = true;
        requestAnimationFrame(() => brand.classList.add('motion-ready'));
    }
}

function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
}
addEventListener('scroll', schedule, { passive: true });
addEventListener('resize', measure);
reducedMotion.addEventListener('change', schedule);
document.fonts.ready.then(measure);
measure();
