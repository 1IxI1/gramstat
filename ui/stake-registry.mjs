export function createStakeRegistry(element) {
    const dialog = element('dialog', 'wallet-registry');
    dialog.id = 'stake-registry';
    dialog.setAttribute('aria-labelledby', 'stake-registry-title');
    const heading = element('div', 'wallet-registry-heading');
    const title = element('h2', '', 'Verified staking contracts');
    title.id = 'stake-registry-title';
    const close = element('button', 'wallet-registry-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close staking contracts');
    close.onclick = () => dialog.close();
    heading.append(title, close);
    const content = element('div');
    dialog.append(heading, content);
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    let loaded;
    async function open() {
        if (!dialog.open) dialog.showModal();
        close.focus();
        if (loaded) return;
        content.replaceChildren(element('p', 'chart-status', 'Loading verified contracts…'));
        loaded = import('./stake-contracts.mjs');
        try {
            const { STAKE_CONTRACTS, STAKE_REGISTRY_AS_OF } = await loaded;
            const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(STAKE_REGISTRY_AS_OF));
            const note = element('p', 'chart-description', `Pool links and on-chain staking-contract code hashes checked ${date}. Expand a group to see the verified holder addresses.`);
            const table = element('table', 'wallet-registry-table stake-registry-table');
            const head = element('thead'), header = element('tr');
            for (const label of ['Protocol', 'Verified addresses and code']) {
                const cell = element('th', '', label); cell.scope = 'col'; header.append(cell);
            }
            head.append(header);
            const body = element('tbody');
            for (const group of STAKE_CONTRACTS) {
                const row = element('tr');
                const name = element('th', '', group.protocol); name.scope = 'row';
                const values = element('td', 'wallet-code-hash');
                values.append(element('span', 'wallet-hash-label', 'Pool / treasury'), element('code', '', group.pool),
                    element('span', 'wallet-hash-label', 'Staking contract code hash · hex'), element('code', '', group.codeHash));
                const details = element('details', 'stake-holder-addresses');
                details.append(element('summary', '', `Holder addresses (${group.holders.length})`));
                details.addEventListener('toggle', () => {
                    if (!details.open || details.childElementCount > 1) return;
                    const list = element('div');
                    for (const address of group.holders) list.append(element('code', '', address));
                    details.append(list);
                });
                values.append(details);
                row.append(name, values); body.append(row);
            }
            table.append(head, body); content.replaceChildren(note, table);
        } catch {
            loaded = undefined;
            content.replaceChildren(element('p', 'chart-status', 'Verified contracts could not be loaded.'));
        }
    }
    return {
        dialog,
        button() {
            const p = element('p', 'chart-description');
            const button = element('button', 'wallet-registry-link', 'Verified staking contracts');
            button.type = 'button'; button.setAttribute('aria-haspopup', 'dialog');
            button.setAttribute('aria-controls', dialog.id); button.onclick = open;
            p.append(button); return p;
        },
    };
}
