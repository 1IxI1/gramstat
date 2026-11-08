// Frozen registry shared with the wallet aggregator. Source links for standard
// versions follow TON Docs /contracts/standard/wallets/sources. Older Highload
// and beta links expose source history rather than claiming a verified build.
export const WALLET_REGISTRY_SHA256 = 'fc96280e446129a605659a022311bba1d0d6bef9a03960be77c86a259dc876f9';
const ton = (revision, file) => `https://github.com/ton-blockchain/ton/blob/${revision}/crypto/smartcont/${file}`;
const legacy = (file) => `https://github.com/ton-blockchain/ton/commits/master/crypto/smartcont/${file}`;
const beta = 'https://github.com/tonkeeper/w5/commits/main/contracts/wallet_v5.fc';
const row = (type, name, hex, source, sourceLabel = 'Source code') => Object.freeze({ type, name, hex, source, sourceLabel });
export const WALLET_CODES = Object.freeze([
    row('wallet_v1r1', 'V1 R1', 'a0cfc2c48aee16a271f2cfc0b7382d81756cecb1017d077faaab3bb602f6868c', ton('c2da007f4065e2520e0d948b146e0fb12fa75751', 'new-wallet.fif')),
    row('wallet_v1r2', 'V1 R2', 'd4902fcc9fad74698fa8e353220a68da0dcf72e32bcb2eb9ee04217c17d3062c', ton('47814dca3d4d7d253f0dcbb2ef176f45aafc6871', 'new-wallet.fif')),
    row('wallet_v1r3', 'V1 R3', '587cc789eff1c84f46ec3797e45fc809a14ff5ae24f1e0c7a6a99cc9dc9061ff', ton('53ec9684bd213983e1fe0f7610d3e3453a4ec628', 'new-wallet.fif')),
    row('wallet_v2r1', 'V2 R1', '5c9a5e68c108e18721a07c42f9956bfb39ad77ec6d624b60c576ec88eee65329', ton('fd7a8de9708c9ece8d802890519735b55bc99a8e', 'new-wallet-v2.fif')),
    row('wallet_v2r2', 'V2 R2', 'fe9530d3243853083ef2ef0b4c2908c0abf6fa1c31ea243aacaa5bf8c7d753f1', ton('53ec9684bd213983e1fe0f7610d3e3453a4ec628', 'new-wallet-v2.fif')),
    row('wallet_v3r1', 'V3 R1', 'b61041a58a7980b946e8fb9e198e3c904d24799ffa36574ea4251c41a566f581', ton('3002321eb779e9936243e3b5f00be7579fb07654', 'new-wallet-v3.fif')),
    row('wallet_v3r2', 'V3 R2', '84dafa449f98a6987789ba232358072bc0f76dc4524002a5d0918b9a75d2d599', ton('040df63c9864f2f37ebe50c4cafcc01f2d5d2d5c', 'wallet-v3-code.fif')),
    row('wallet_v4r1', 'V4 R1', '64dd54805522c5be8a9db59cea0105ccf0d08786ca79beb8cb79e880a8d7322d', 'https://github.com/ton-blockchain/wallet-contract/blob/0f9e25acd61a8384887f4d6c017b8cdbd7cf2213/func/wallet-v4-code.fc'),
    row('wallet_v4r2', 'V4 R2', 'feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0', 'https://github.com/ton-blockchain/wallet-contract/blob/4111fd9e3313ec17d99ca9b5b1656445b5b49d8f/func/wallet-v4-code.fc'),
    row('wallet_v5_beta', 'V5 beta', 'e4cf3b2f4c6d6a61ea0f2b5447d266785b26af3637db2deee6bcd1aa826f3412', beta, 'Source history'),
    row('wallet_v5_beta', 'V5 beta', 'f3d7ca53493deedac28b381986a849403cbac3d2c584779af081065af0ac4b93', beta, 'Source history'),
    row('wallet_v5r1', 'V5 R1', '20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f', 'https://github.com/ton-blockchain/wallet-contract-v5/blob/88557ebc33047a95207f6e47ac8aadb102dff744/contracts/wallet_v5.fc'),
    row('wallet_highload_v1r1', 'Highload V1 R1', 'd8cdbbb79f2c5caa677ac450770be0351be21e1250486de85cc52aa33dd16484', legacy('highload-wallet-code.fc'), 'Source history'),
    row('wallet_highload_v1r2', 'Highload V1 R2', '0dceed21269d66013e95b19fbb5c55a6f01adad40837baa8e521cde3a02aa46c', legacy('highload-wallet-code.fc'), 'Source history'),
    row('wallet_highload_v2', 'Highload V2', '9494d1cc8edf12f05671a1a9ba09921096eb50811e1924ec65c3c629fbb80812', legacy('highload-wallet-v2-code.fc'), 'Source history'),
    row('wallet_highload_v2r1', 'Highload V2 R1', '8ceb45b3cd4b5cc60eaae1c13b9c092392677fe536b2e9b2d801b62eff931fe1', legacy('highload-wallet-v2-code.fc'), 'Source history'),
    row('wallet_highload_v2r2', 'Highload V2 R2', '203dd4f358adb49993129aa925cac39916b68a0e4f78d26e8f2c2b69eafa5679', legacy('highload-wallet-v2-code.fc'), 'Source history'),
    row('wallet_highload_v3r1', 'Highload V3 R1', '11acad7955844090f283bf238bc1449871f783e7cc0979408d3f4859483e8525', 'https://github.com/ton-blockchain/highload-wallet-contract-v3/blob/f5d9b592bd5ab5c9ae6ca627819929e140f6bd61/contracts/highload-wallet-v3.func'),
    row('wallet_tg', 'WalletTg', '9149ae51c1e4689710cebf7830297b16acfbadb363a920a537893e7ffeeca768', 'https://github.com/ton-blockchain/tg-wallet-contract/blob/1a29ae5d90e03c3d585d3e42e6ecef691d727a3c/contracts/WalletTrampoline.fif'),
]);

export function createWalletRegistry(element) {
    const dialog = element('dialog', 'wallet-registry');
    dialog.id = 'wallet-registry';
    dialog.setAttribute('aria-labelledby', 'wallet-registry-title');
    const heading = element('div', 'wallet-registry-heading');
    const title = element('h2', '', 'Included wallet codes');
    title.id = 'wallet-registry-title';
    const close = element('button', 'wallet-registry-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close wallet codes');
    close.onclick = () => dialog.close();
    heading.append(title, close);
    const table = element('table', 'wallet-registry-table');
    const head = element('thead');
    const labels = element('tr');
    for (const label of ['Wallet', 'Code hash', 'Source']) {
        const th = element('th', '', label);
        th.scope = 'col';
        labels.append(th);
    }
    head.append(labels);
    const body = element('tbody');
    for (const item of WALLET_CODES) {
        const tr = element('tr');
        const name = element('th', '', item.name);
        name.scope = 'row';
        const hash = element('td', 'wallet-code-hash');
        const base64 = btoa(String.fromCharCode(...item.hex.match(/../g).map((byte) => parseInt(byte, 16))));
        for (const [label, value] of [['Hex', item.hex], ['Base64', base64]]) {
            hash.append(element('span', 'wallet-hash-label', label), element('code', '', value));
        }
        const source = element('td');
        const a = element('a', '', item.sourceLabel);
        a.href = item.source;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', `${item.name}: ${item.sourceLabel.toLowerCase()} (opens in a new tab)`);
        source.append(a);
        tr.append(name, hash, source);
        body.append(tr);
    }
    table.append(head, body);
    dialog.append(heading, table);
    document.body.append(dialog);
    dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    return {
        dialog,
        description(definition) {
            const p = element('p', 'chart-description');
            let cursor = 0;
            for (const term of definition.registryTerms ?? [definition.registryTerm]) {
                const start = definition.description.indexOf(term, cursor);
                if (start < 0) continue;
                const button = element('button', 'wallet-registry-link', term);
                button.type = 'button';
                button.setAttribute('aria-haspopup', 'dialog');
                button.setAttribute('aria-controls', dialog.id);
                button.onclick = () => { dialog.showModal(); close.focus(); };
                p.append(definition.description.slice(cursor, start), button);
                cursor = start + term.length;
            }
            p.append(definition.description.slice(cursor));
            return p;
        },
    };
}
