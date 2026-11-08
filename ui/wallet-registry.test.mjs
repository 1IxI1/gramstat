import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { WALLET_CODES, WALLET_REGISTRY_SHA256 } from './wallet-registry.mjs';

test('displayed wallet hashes and types match the frozen aggregator registry digest', () => {
    const families = {};
    for (const row of WALLET_CODES) {
        assert.match(row.hex, /^[0-9a-f]{64}$/);
        (families[row.type] ??= []).push(Buffer.from(row.hex, 'hex').toString('base64'));
        assert.equal(new URL(row.source).origin, 'https://github.com');
    }
    assert.equal(WALLET_CODES.length, 19);
    assert.equal(new Set(WALLET_CODES.map((row) => row.hex)).size, 19);
    assert.equal(Object.keys(families).length, 18);
    // Same serialization as the registry exporter's json.dumps(sort_keys=True).
    const canonical = `{${Object.keys(families).sort().map((key) =>
        `${JSON.stringify(key)}: [${families[key].sort().map((hash) => JSON.stringify(hash)).join(', ')}]`).join(', ')}}`;
    assert.equal(createHash('sha256').update(canonical).digest('hex'), WALLET_REGISTRY_SHA256);
});
