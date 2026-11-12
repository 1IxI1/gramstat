export const COLORS = Object.freeze({ blue: 'var(--chart-blue)', green: '#5c9980', red: '#c27870', paleBlue: 'var(--pale-blue)' });
const palette = [COLORS.blue, COLORS.green, COLORS.red, '#9b88ad', 'light-dark(#a37741, #c79a54)', 'light-dark(#4b8789, #619d9f)'];
export const colorAt = (i) => palette[i % palette.length];
const series = (id, label, i = 0) => ({ id, label, color: colorAt(i), demo: false });
const stakePoolColors = {
    Tonstakers: '#27956a', 'Tonstakers-like': 'light-dark(#468d70, #80b59f)',
    Stakee: '#2c92bd', 'Stakee-like': 'light-dark(#4488a5, #85bbd1)',
    Hipo: 'light-dark(#a2763c, #c4873e)', 'Hipo-like': 'light-dark(#9f783f, #dfb67d)',
    Bemo: '#bd6782', 'Bemo-like': 'light-dark(#ad617e, #dca2b5)',
    'Whales wsTON': '#6369b6', 'Whales-like': 'light-dark(#747aad, #a4a8d4)',
};
// Protocol names and -like labels are distinct prepared categories. Keep their
// IDs, order and colors stable when the selected date range changes.
export function stakePoolSeries(labels) {
    const order = Object.keys(stakePoolColors);
    const rank = label => order.includes(label) ? order.indexOf(label) : order.length;
    return [...new Set(labels)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en')).map(label => {
        const hash = [...label].reduce((hash, c) => (hash * 31 + c.codePointAt(0)) >>> 0, 0);
        return { ...series(`pool:${label}`, label), poolLabel: label,
            color: Object.hasOwn(stakePoolColors, label) ? stakePoolColors[label] : colorAt(hash), fillOpacity: label.endsWith('-like') ? 0.32 : 0.48 };
    });
}
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
        container: 'accounts-charts',
        layout: 'full',
        kind: 'stacked-area', step: true, integer: true, zero: true,
        series: [
            { ...series('frozen', 'Frozen'), color: 'light-dark(#4288b0, #65b5e5)' },
            { ...series('uninit', 'Uninitialized'), color: 'light-dark(#94710a, #d9b83f)' },
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
        container: 'transaction-charts',
        layout: 'full',
        averageUnit: 'tx/day',
        kind: 'bar', zero: true,
        description: 'Both masterchain (-1) and basechain (0) transactions. Transaction != action or logical event. In TON, average jetton transfer consists of 5 transactions.',
        descriptionEmphasis: '5 transactions',
    }),
    chart('active_wallets_daily', 'Active wallets', 'wallet', '', {
        layout: 'full', kind: 'bar', zero: true, integer: true, averageUnit: 'wallets/day', registryTerm: 'wallet', registryTerms: ['wallet', 'wallets'],
        description: "Unique addresses that sent at least one non-bounced message during the selected window, after or in the same transaction as their first recognized wallet deployment. Internal and external-out messages count, including sends initiated through extensions; incoming messages alone do not count. Once an address has been deployed as a recognized wallet, its later sends still count, even if its code changes or it is deleted and deployed again (because wallets don't allow code changes really).",
    }),
    chart('activations', 'Activations per day', 'wallet', '', {
        layout: 'half', kind: 'bar', zero: true, integer: true, averageUnit: 'wallets/day', registryTerm: 'wallet code',
        description: 'Unique addresses first deployed with a recognized wallet code each UTC day, using the deployment transaction’s time. Earlier non-wallet deployments do not exclude an address; repeated wallet deployments are not counted again. Outgoing messages are not required.',
    }),
    chart('activated_wallets', 'Activated wallets', 'wallet', '', {
        layout: 'half', step: true, fill: true, integer: true, registryTerm: 'wallet code',
        description: 'Total unique addresses that have been deployed with a recognized wallet code. Each address is counted once, at its first qualifying wallet deployment, even if it previously hosted a different contract. Outgoing messages are not required. Later deletion, freezing, code changes or redeployment do not remove the address from this total.',
    }),
    chart('validator_count', 'Validators', 'validator', '', {
        kind: 'step', round: true, integer: true,
        description: 'Number of elected validators in each validation round.',
    }),
    chart('stake', 'Stake by round', 'validator', 'GRAM', {
        kind: 'step', round: true, layout: 'wide',
        series: [series('submitted', 'Submitted'), series('selected', 'Selected', 1), series('remaining', 'Remaining', 2), { ...series('reward', 'Reward', 3), axis: 'right', kind: 'bar' }],
        secondaryAxisLabel: 'Reward (GRAM)',
        description: 'Submitted: accepted election applications, including unselected candidates and excess stake.\nSelected: stake retained after elections.\nRemaining: stake left after fines, immediately before release, excluding rewards.\nRewards: well, rewards. Accumulated each round and distributed in proportion to each validator\'s stake.',
    }),
    chart('validator_geo', 'Validators with coordinates and countries', 'validator', '', {
        kind: 'step', time: true, integer: true, zero: true, layout: 'full', container: 'validator-geo-charts',
        historyStart: Date.parse('2024-10-01T01:23:19Z'),
        secondaryOverlay: true, primaryAxisLabel: 'Validators', secondaryAxisLabel: 'Countries', rangeTicks: true,
        series: [series('located', 'Validators with coordinates'), { ...series('countries', 'Countries', 1), axis: 'right' }],
        description: 'Drag across this chart to select a time range; the map follows its end.',
    }),
    chart('staking_apr', 'Staking APR', 'validator', '%', {
        kind: 'step', round: true, layout: 'wide',
        description: 'Annualized validator staking returns without reinvestment, based on capital locked for two validation rounds. Each round lasts 18 h, 12 min, and 16 s. Rewards are distributed in proportion to each validator’s remaining stake after penalties. Every validator without penalties earns the same percentage return. Penalties reduce the returned stake but are not deducted when calculating this APR.\nAPR = (Rewards / Selected stake) × (365 days / Two-round duration) × 100%',
    }),
    chart('staking_apy', 'Staking APY', 'validator', '%', {
        unavailable: 'No reinvestment model.',
        emptyMessage: {
            title: 'A constant-rate APY can be misleading for TON staking.',
            text: 'As the chart above shows, reinvesting does not increase total rewards in GRAM. Most validators appear to reinvest, as the chart below shows. This increases total stake and lowers APR if total rewards stay unchanged.',
        },
    }),
    chart('stake_changes', 'Stake changes between rounds', 'validator', '%', {
        kind: 'stacked-area', step: true, round: true, share: true, layout: 'full',
        defaultHiddenSeries: ['below_reward', 'above_reward', 'unchanged', 'decreased'],
        series: [{ ...series('near_reward', 'Increase ≈ reward', 1), color: '#27956a', emphasis: true, fillOpacity: 0.48 }, series('below_reward', 'Increase < reward'),
            series('above_reward', 'Increase > reward', 3), series('unchanged', 'Unchanged', 4), series('decreased', 'Decreased', 2)],
        description: 'Increase ≈ reward means the stake increase matches previous obtained reward within 2% or 5 GRAM. Which probably means these validators are reinvesting their rewards.\nEach round n is compared with round n−2 for stake-holder addresses present in both.',
        descriptionStrong: 'Increase ≈ reward',
        descriptionEmphasis: 'these validators are reinvesting',
    }),
    chart('stake_locked', 'Total Stake Locked', 'validator', 'GRAM', {
        kind: 'stacked-area', step: true, round: true, zero: true, layout: 'full', stackTotalLabel: 'Visible total',
        series: [
            { ...series('telegram', 'Telegram', 3), fillOpacity: 0.45 },
            { ...series('others', 'Others'), color: '#8a9da9', fillOpacity: 0.3 },
            { ...series('total', 'Total'), color: 'var(--text)', overlay: true },
        ],
        description: 'Stakes remain locked after a validation round ends, so validators need separate funds for consecutive rounds. To show the total capital committed to staking, this chart adds the selected stakes of the current and previous rounds, treating each stake as locked for two full rounds.\n\nLiquid Staking is broken down by protocol and contract type. Protocol names indicate confirmed affiliation; the “-like” suffix indicates a recognized staking contract type whose protocol affiliation has not yet been confirmed. Amounts include validators’ own collateral.\n\nOthers is the total stake selected by the Elector across both rounds, minus the amounts attributed to Telegram and Liquid Staking.',
        descriptionStrong: 'total capital committed to staking',
        descriptionEmphasis: 'yet',
        stakeRegistry: true,
    }),
    chart('jetton_transfers', 'Jetton transfers', 'activity', '', { kind: 'bar', zero: true }),
    chart('nft_transfers', 'NFT transfers', 'activity', '', { kind: 'bar', zero: true }),
    chart('swaps_total', 'Swaps', 'activity', '', { kind: 'bar', zero: true }),
    chart('jetton_users', 'Jetton senders / receivers', 'activity', '', {
        series: [series('jetton_senders', 'Senders'), series('jetton_receivers', 'Receivers', 1)],
        description: 'Unique addresses sending or receiving jettons through successful transfers. Includes wallets and smart contracts, with no token whitelist or spam filter.\nEach address is counted once per UTC day.',
        monthlyDescription: 'Unique addresses sending or receiving jettons through successful transfers. Includes wallets and smart contracts, with no token whitelist or spam filter.\nEach address is counted once per UTC calendar month.',
    }),
    chart('nft_users', 'NFT senders / receivers', 'activity', '', {
        series: [series('nft_senders', 'Senders'), series('nft_receivers', 'Receivers', 1)],
        description: 'Unique addresses sending or receiving NFTs through successful transfers. Includes wallets and smart contracts, with no collection whitelist or spam filter.\nEach address is counted once per UTC day.',
        monthlyDescription: 'Unique addresses sending or receiving NFTs through successful transfers. Includes wallets and smart contracts, with no collection whitelist or spam filter.\nEach address is counted once per UTC calendar month.',
    }),
    chart('swaps_users', 'Swap users', 'activity', '', {
        description: 'Unique addresses initiating successful swaps recognized by Toncenter actions. Includes wallets and smart contracts.\nEach address is counted once per UTC day.',
        monthlyDescription: 'Unique addresses initiating successful swaps recognized by Toncenter actions. Includes wallets and smart contracts.\nEach address is counted once per UTC calendar month.',
    }),
    chart('swaps_dex', 'Swaps by DEX', 'activity', '', {
        kind: 'stacked-bar',
        zero: true,
        dynamic: true,
        layout: 'wide',
    }),
    chart('ton_dns_mints', '.ton DNS mints', 'activity', '', {
        kind: 'bar', zero: true,
        description: 'Newly minted .ton domain NFTs per UTC day. Transfers, purchases, renewals, and re-auctions of existing domains are not counted.',
        monthlyDescription: 'Newly minted .ton domain NFTs per UTC calendar month. Transfers, purchases, renewals, and re-auctions of existing domains are not counted.',
    }),
    chart('liquid_staking_deposits', 'Liquid staking deposits', 'activity', '', {
        kind: 'bar', zero: true,
        description: 'Number of successful deposits into Tonstakers, Stakee, KTON, and sGRAM. Counts deposits, not unique depositors.',
    }),
    chart('lst_amount', 'Liquid stakes deposited', 'activity', 'GRAM', {
        description: 'Total GRAM deposited into Tonstakers, Stakee, KTON, and sGRAM. Withdrawals are not subtracted. Purchases and transfers of liquid-staking tokens are not counted.',
        kind: 'stacked-bar',
        zero: true,
        layout: 'wide',
        series: ['tonstakers', 'stakee', 'kton', 'sgram'].map((id, i) => series(id, id, i)),
        note: 'Selected four pools. A pool with unknown deposit amounts stays unknown.',
    }),
    chart('telegram_stars_purchases', 'Stars purchases', 'activity', '', {
        kind: 'bar', zero: true,
        description: 'Number of payments for Telegram Stars through Fragment in GRAM or USDT, after spam filtering.',
    }),
    chart('stars_quantity', 'Stars purchased', 'activity', 'Stars', {
        kind: 'bar',
        zero: true,
        description: 'Telegram Stars purchased through Fragment, after spam filtering.',
    }),
    chart('stars_unknown', 'Stars purchases · unknown size', 'activity', '', {
        kind: 'bar', zero: true,
        description: 'Number of Stars-labelled payments to Fragment whose quantity could not be determined or validated.',
    }),
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
