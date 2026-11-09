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
        averageUnit: 'GRAM/day',
        annotations: [BURN_START],
        kind: 'bar', zero: true,
        description: 'Total fees collected from transaction (compute, action etc.) fees and message import fees each UTC day.',
    }),
    chart('minted', 'Daily issuance', 'gram', 'GRAM', {
        averageUnit: 'GRAM/day',
        annotations: [SUBSECOND_START],
        kind: 'bar', zero: true,
        description: 'New GRAM issued as block rewards each UTC day.',
    }),
    chart('burned', 'Daily burn', 'gram', 'GRAM', {
        averageUnit: 'GRAM/day',
        description: 'GRAM burned from transaction fees (50% of them) and funds sent to −1:ff…ff each UTC day.',
        annotations: [BURN_START],
        kind: 'bar',
        zero: true,
    }),
    chart('accounts', 'Accounts', 'gram', '', {
        layout: 'wide',
        kind: 'stacked-area', step: true, integer: true, zero: true,
        series: [
            { ...series('frozen', 'Frozen'), color: '#65b5e5' },
            { ...series('uninit', 'Uninitialized'), color: '#d9b83f' },
            { ...series('active', 'Active'), color: '#5c9980' },
        ],
        description: [
            'Active: a wallet or smart contract is deployed and can process transactions.',
            'Uninitialized: account got money, but no wallet or contract code is deployed.',
            'Frozen: a previously deployed account is paused due to unpaid storage fees.',
            'Masterchain included. Deleted accounts (after send mode +32) are excluded.',
        ].join('\n'),
    }),
    chart('transactions', 'Transactions per day', 'gram', '', {
        averageUnit: 'tx/day',
        kind: 'bar', zero: true,
        description: 'Both masterchain (-1) and basechain (0) transactions.',
    }),
    chart('active_wallets_daily', 'Active wallets', 'wallet', '', {
        layout: 'full', kind: 'bar', zero: true, integer: true, registryTerm: 'wallet', registryTerms: ['wallet', 'wallets'],
        description: "Unique addresses that sent at least one non-bounced message during the selected window, after or in the same transaction as their first recognized wallet deployment. Internal and external-out messages count, including sends initiated through extensions; incoming messages alone do not count. Once an address has been deployed as a recognized wallet, its later sends still count, even if its code changes or it is deleted and deployed again (because wallets don't allow code changes really).",
    }),
    chart('activations', 'Activations per day', 'wallet', '', {
        layout: 'half', kind: 'bar', zero: true, integer: true, registryTerm: 'wallet code',
        description: 'Unique addresses first deployed with a recognized wallet code each UTC day, using the deployment transaction’s time. Earlier non-wallet deployments do not exclude an address; repeated wallet deployments are not counted again. Outgoing messages are not required.',
    }),
    chart('activated_wallets', 'Activated wallets', 'wallet', '', {
        layout: 'half', step: true, integer: true, registryTerm: 'wallet code',
        description: 'Total unique addresses that have been deployed with a recognized wallet code. Each address is counted once, at its first qualifying wallet deployment, even if it previously hosted a different contract. Outgoing messages are not required. Later deletion, freezing, code changes or redeployment do not remove the address from this total.',
    }),
    chart('stake', 'Staked GRAM', 'validator', 'GRAM', {
        layout: 'wide',
        unavailable: 'Round-level stake series have not been prepared for this API yet.',
    }),
    chart('validator_count', 'Validators', 'validator', '', {
        kind: 'step', round: true, integer: true,
        description: 'Number of elected validators in each validation round.',
    }),
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
