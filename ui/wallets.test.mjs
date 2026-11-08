import assert from 'node:assert/strict';
import test from 'node:test';
import { walletSeries } from './data.mjs';
import { buildRows } from './charts.mjs';
import { WALLET_REGISTRY_SHA256 } from './wallet-registry.mjs';

test('wallet adapter preserves MC ties, exact zero, and missing-day gaps', () => {
    const data = { schemaVersion: 2, registry: WALLET_REGISTRY_SHA256, period: { from: '2024-10-13T00:00:00Z', to: '2024-10-15T00:00:00Z' }, coverageDays: ['2024-10-13'],
        activated: { intervalSeconds: 0, points: [{ utime: 1728777601, mc_seqno: 10, value: '4' }, { utime: 1728777601, mc_seqno: 11, value: '5' }] },
        active: { intervalSeconds: 60, points: [{ utime: 1728777600, value: '0' }] } };
    const series = walletSeries(data, 'activated_wallets');
    const rows = buildRows(series.points.map(p => p[0]), [series]);
    assert.deepEqual(rows.slice(0, 2).map(r => r.values[0]), [4, 5]);
    assert.match(series.detailsByIndex[1], /MC 11/);
    assert.equal(rows.at(-1).values[0], null);
    const active = walletSeries(data, 'active_wallets_daily');
    assert.equal(active.exactByIndex[0], '0');
    assert.equal(active.exactByIndex.at(-1), null);
    assert.throws(() => walletSeries({ ...data, registry: 'different' }, 'activated_wallets'));
});
