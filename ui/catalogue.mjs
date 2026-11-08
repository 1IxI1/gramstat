export const COLORS = Object.freeze({ blue: '#5b91b1', green: '#5c9980', red: '#c27870', paleBlue: '#9cb8c7' });
const palette = ['#5b91b1', '#5c9980', '#c27870', '#9b88ad', '#c79a54', '#619d9f'];
export const colorAt = (i) => palette[i % palette.length];
const series = (id, label, i = 0) => ({ id, label, color: colorAt(i), demo: false });
const chart = (id, title, section, unit = '', options = {}) => ({
    id,
    title,
    section,
    unit,
    kind: 'line',
    series: [series('total', title)],
    ...options,
});
const walletReason =
    'Full deployment history is required to identify first activations and previously deployed wallets.';
const BURN_START = Object.freeze({
    id: 'protocol-burning-start', utime: 1686983606, mc: 30410593,
    label: '50% fees burn start', color: '#32875a',
});
// Config #30 enables the new consensus on both chains in this key block.
const SUBSECOND_START = Object.freeze({
    id: 'subsecond-start', utime: 1775718744, mc: 59238081,
    label: '2.5 → 0.4s blocks', color: '#9063b5',
});
export const CATALOGUE = [
    chart('supply', 'Total supply', 'gram', 'GRAM', {
        description: 'Total supply is the sum of account balances and funds in transit, including collected fees not yet credited to validators. Protocol-burned funds are excluded (e.g. the 50% of transaction fees burned by the protocol). Transfers to 0:00…00 remain included (though they’re inaccessible); funds burned at −1:ff…ff are excluded.',
        annotations: [BURN_START, SUBSECOND_START],
        layout: 'wide',
        fill: true,
    }),
    chart('inflation', 'Annual inflation', 'gram', '%', {
        annotations: [BURN_START, SUBSECOND_START],
        signed: true,
        description: 'Estimated annual supply growth if issuance and burning continue at their average rates over the preceding 24 hours. Calculated hourly: (minted − burned) over 24h ÷ total supply × 365 × 100%.',
    }),
    chart('fees', 'Daily fees', 'gram', 'GRAM', {
        kind: 'bar', zero: true,
        description: 'Total fees collected from transaction (compute, action etc.) fees and message import fees each UTC day.',
    }),
    chart('minted', 'Daily issuance', 'gram', 'GRAM', {
        kind: 'bar', zero: true,
        description: 'New GRAM issued as block rewards each UTC day.',
    }),
    chart('burned', 'Daily burn', 'gram', 'GRAM', {
        description: 'GRAM burned from transaction fees (50% of them) and funds sent to −1:ff…ff each UTC day.',
        annotations: [BURN_START, SUBSECOND_START],
        kind: 'bar',
        zero: true,
        note: 'Total protocol burning. A fees / blackhole split is not available.',
    }),
    chart('accounts', 'Accounts', 'gram', '', {
        layout: 'wide',
        unavailable:
            'Absolute account counts require a verified opening state and continuous account deltas. This series has not been prepared yet.',
    }),
    chart('transactions', 'Transactions per day', 'gram', '', {
        kind: 'bar', zero: true,
        description: 'Both masterchain (-1) and basechain (0) transactions.',
    }),
    ...[
        ['activated_wallets', 'Activated wallets'],
        ['activations', 'Activations per day'],
        ['active_wallets_daily', 'Active wallets · daily'],
        ['active_wallets_monthly', 'Active wallets · 30 days'],
    ].map(([id, title]) => chart(id, title, 'wallet', '', { layout: 'half', unavailable: walletReason })),
    chart('stake', 'Staked GRAM', 'validator', 'GRAM', {
        layout: 'wide',
        unavailable: 'Round-level stake series have not been prepared for this API yet.',
    }),
    chart('validator_count', 'Validators', 'validator', '', { kind: 'step', round: true, integer: true }),
    chart('countries', 'Countries', 'validator', '', {
        kind: 'step',
        round: true,
        integer: true,
        note: 'Observed countries within each validation round. Missing observations can reduce coverage.',
    }),
    chart('located', 'Validators with coordinates', 'validator', '', { kind: 'step', round: true, integer: true }),
    chart('staking_apr', 'Staking APR', 'validator', '%', {
        unavailable: 'Verified round returns have not been aggregated yet.',
    }),
    chart('staking_apy', 'Staking APY', 'validator', '%', {
        unavailable: 'Requires verified returns and an explicit reinvestment model.',
    }),
    chart('telegram_share', 'Telegram share', 'validator', '%', {
        layout: 'half',
        unavailable: 'Historical validator attribution has not been published.',
    }),
    chart('liquid_staking_share', 'Liquid staking share', 'validator', '%', {
        layout: 'half',
        unavailable: 'Validator stake attribution is separate from deposit activity.',
    }),
    chart('jetton_transfers', 'Jetton transfers', 'activity', '', { kind: 'bar', zero: true }),
    chart('nft_transfers', 'NFT transfers', 'activity', '', { kind: 'bar', zero: true }),
    chart('jetton_users', 'Jetton senders / receivers', 'activity', '', {
        series: [series('jetton_senders', 'Senders'), series('jetton_receivers', 'Receivers', 1)],
    }),
    chart('nft_users', 'NFT senders / receivers', 'activity', '', {
        series: [series('nft_senders', 'Senders'), series('nft_receivers', 'Receivers', 1)],
    }),
    chart('swaps_total', 'Swaps', 'activity', '', { kind: 'bar', zero: true }),
    chart('swaps_users', 'Swap users', 'activity'),
    chart('swaps_dex', 'Swaps by DEX', 'activity', '', {
        kind: 'stacked-bar',
        zero: true,
        dynamic: true,
        layout: 'wide',
    }),
    chart('ton_dns_mints', '.ton DNS mints', 'activity', '', { kind: 'bar', zero: true }),
    chart('liquid_staking_deposits', 'Liquid staking deposits', 'activity', '', { kind: 'bar', zero: true }),
    chart('lst_amount', 'Liquid staking deposited', 'activity', 'GRAM', {
        kind: 'stacked-bar',
        zero: true,
        layout: 'wide',
        series: ['tonstakers', 'stakee', 'kton', 'sgram'].map((id, i) => series(id, id, i)),
        note: 'Selected four pools. A pool with unknown deposit amounts stays unknown.',
    }),
    chart('telegram_stars_purchases', 'Stars purchases', 'activity', '', { kind: 'bar', zero: true }),
    chart('stars_quantity', 'Stars purchased', 'activity', 'Stars', {
        kind: 'bar',
        zero: true,
        note: 'Full quantity is unknown if any purchase has an unrecognized size.',
    }),
    chart('stars_known', 'Known Stars subtotal', 'activity', 'Stars', {
        kind: 'bar',
        zero: true,
        note: 'Known quantities only; this is a subtotal when some purchase sizes are unknown.',
    }),
    chart('stars_unknown', 'Stars purchases · unknown size', 'activity', '', { kind: 'bar', zero: true }),
];

export function periodDates(from, to) {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    const count = (end - start) / 86400000;
    if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 3660 ||
        new Date(start).toISOString().slice(0, 10) !== from ||
        new Date(end).toISOString().slice(0, 10) !== to
    ) {
        throw new Error('Choose a UTC interval of 1–3660 days.');
    }
    return Array.from({ length: count }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
