import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CATALOGUE } from './catalogue.mjs';

test('each chart has a container on the intended statistics page', async () => {
    const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    const activity = html.split('id="page-activity"')[1].split('id="page-tokenomics"')[0];
    const tokenomics = html.split('id="page-tokenomics"')[1].split('</main>')[0];
    assert.match(activity, /id="accounts-charts"/);
    assert.match(activity, /id="transaction-charts"/);
    assert.match(activity, /id="activity-charts"/);
    assert.match(tokenomics, /id="gram-charts"/);
    assert.match(tokenomics, /id="validator-charts"/);
    for (const chart of CATALOGUE) {
        const container = chart.container || `${chart.section}-charts`;
        const page = chart.section === 'validator' || (chart.section === 'gram' && !['accounts', 'transactions'].includes(chart.id)) ? tokenomics : activity;
        assert.ok(page.includes(`id="${container}"`), `${chart.id} has no container on its page`);
    }
    assert.ok(activity.indexOf('id="accounts-charts"') < activity.indexOf('id="wallet-charts"'));
    assert.ok(activity.indexOf('id="wallet-charts"') < activity.indexOf('id="transaction-charts"'));
    assert.ok(activity.indexOf('id="transaction-charts"') < activity.indexOf('id="activity-charts"'));
});
