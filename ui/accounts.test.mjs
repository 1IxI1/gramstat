import assert from 'node:assert/strict';
import test from 'node:test';
import { accountsSeries } from './data.mjs';
import { buildRows } from './charts.mjs';

test('Accounts preserve zeros, deletions and same-second state transitions', () => {
    const series = accountsSeries({schemaVersion:2, points:[
        {utime:1573862400,mc_seqno:3,total:'8',active:'7',uninit:'1',frozen:'0'},
        {utime:1573862400,mc_seqno:4,total:'7',active:'7',uninit:'0',frozen:'0'},
    ]});
    const rows=buildRows(series.points.map((p)=>p[0]),[series]);
    assert.equal(rows[0].values[0],8);
    assert.equal(rows[1].values[0],7);
    assert.match(series.detailsByIndex[0],/Uninitialized: 1/);
    assert.match(series.detailsByIndex[1],/Uninitialized: 0/);
    assert.match(series.detailsByIndex[1],/MC 4/);
});
