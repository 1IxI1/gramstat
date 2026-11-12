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
const mark = icon.cloneNode();
const text = document.createElement('span');
text.className = 'scroll-brand-text';
const full = document.createElement('span');
full.className = 'scroll-brand-full';
full.textContent = title.textContent;
const short = document.createElement('span');
short.className = 'scroll-brand-short';
short.textContent = 'TON Stats';
text.append(full, short);
brand.append(mark, text);
document.body.append(brand);

let frame = 0;
let brandHeight = 0;
let controlMargin = 0;
let initialized = false;
function measure() {
    const titleRect = title.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const compactScale = innerWidth <= 680 ? 0.55 : 0.7;
    text.style.width = `${titleRect.width}px`;
    text.style.height = `${titleRect.height}px`;
    const gap = parseFloat(getComputedStyle(brand).gap);
    const dockWidth = Math.ceil((iconRect.width + gap + short.offsetWidth) * compactScale);
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
    const y = titleRect.top + (dockRect.top + (dockRect.height - brandHeight * compactScale) / 2 - titleRect.top) * t;
    brand.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    brand.style.setProperty('--brand-full-opacity', String(1 - Math.max(0, Math.min(1, (progress - 0.35) / 0.2))));
    brand.style.setProperty('--brand-short-opacity', String(Math.max(0, Math.min(1, (progress - 0.55) / 0.25))));
    brand.style.opacity = dockRect.bottom <= 0 ? '0' : '1';
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
