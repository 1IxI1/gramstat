import assert from 'node:assert/strict';
import test from 'node:test';
import { accountsSeries } from './data.mjs';
import { buildRows } from './charts.mjs';
import { CATALOGUE } from './catalogue.mjs';

test('Accounts preserve zeros, deletions and same-second state transitions', () => {
    const series = accountsSeries({schemaVersion:2, points:[
        {utime:1573862400,mc_seqno:3,total:'8',active:'7',uninit:'1',frozen:'0'},
        {utime:1573862400,mc_seqno:4,total:'7',active:'7',uninit:'0',frozen:'0'},
    ]});
    const rows=buildRows(series[0].points.map((p)=>p[0]),series);
    assert.deepEqual(series.map((s) => s.label), ['Frozen', 'Uninitialized', 'Active']);
    assert.deepEqual(series.map((s) => s.color), ['#65b5e5', '#d9b83f', '#5c9980']);
    assert.deepEqual(rows[0].values,[0,1,7]);
    assert.deepEqual(rows[1].values,[0,0,7]);
    assert.equal(rows[0].total,8);
    assert.equal(rows[1].total,7);
    assert.equal(series[1].exactByIndex[0],'1');
    assert.equal(series[1].exactByIndex[1],'0');
    assert.match(series[0].detailsByIndex[1],/MC 4/);
    assert.equal(CATALOGUE.find((c) => c.id === 'accounts').kind, 'stacked-area');
});
