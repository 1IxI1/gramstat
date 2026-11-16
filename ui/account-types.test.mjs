import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionTypes, typePercent, typeChildren } from './account-types.mjs';

test('drill-down preserves the exact tail above Number precision', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ accounts: i === 0 ? '9007199254740993' : '1' }));
    const split = partitionTypes(rows, '9007199254741001');
    assert.equal(split.visible.length, 8);
    assert.equal(split.remainder, '1');
    assert.throws(() => partitionTypes(rows, '1'));
    assert.equal(typePercent('9007199254740993', '9007199254741001'), '99.99%');
    assert.equal(typePercent('1', '9007199254741001'), '<0.01%');
    assert.equal(typePercent('0', '0'), '—');
    assert.equal(typePercent('1', '4'), '25%');
});

test('categories retain order while implementation sizes use exact integers', () => {
    const nodes = [
        { id: 'a', parent: 'all', label: 'Unknown', accounts: '100' },
        { id: 'b', parent: 'all', label: 'Wallets', accounts: '50' },
        { id: 'c', parent: 'b', label: 'Larger', accounts: '9007199254740993' },
        { id: 'd', parent: 'b', label: 'Smaller', accounts: '9007199254740992' },
    ];
    assert.deepEqual(typeChildren(nodes, 'all').map(n => n.id), ['b', 'a']);
    assert.deepEqual(typeChildren(nodes, 'b').map(n => n.id), ['c', 'd']);
});
