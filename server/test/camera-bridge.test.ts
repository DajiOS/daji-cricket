import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain JS module outside the server package
import { FrameSplitter, makeGate, redact, rtspUrl, subnetHosts, describeHost } from '../../camera-bridge/lib.mjs';

const jpeg = (n: number, fill: number) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(n, fill), Buffer.from([0xff, 0xd9])]);

test('bridge cuts a byte stream into whole pictures, however the chunks fall', () => {
  const got: Buffer[] = [];
  const s = new FrameSplitter((f: Buffer) => got.push(Buffer.from(f)));
  const all = Buffer.concat([jpeg(10, 1), jpeg(20, 2), jpeg(5, 3)]);
  for (let i = 0; i < all.length; i += 7) s.push(all.subarray(i, i + 7));
  assert.equal(got.length, 3);
  assert.deepEqual(got.map((g) => g.length), [14, 24, 9]);
});

test('bridge builds the Dahua address and hides the password in logs', () => {
  const u = rtspUrl({ host: '10.0.0.5', user: 'view', password: 'p@ss:w/rd' }, 3);
  assert.equal(u, 'rtsp://view:p%40ss%3Aw%2Frd@10.0.0.5:554/cam/realmonitor?channel=3&subtype=1');
  assert.ok(!redact(u).includes('ss%3A'));
});

test('bridge sends fast when watched and slowly when not', () => {
  const g = makeGate({ watchingMs: 200, idleMs: 10000 });
  assert.equal(g.allow(100000), true);
  assert.equal(g.allow(100300), false);
  g.setWatchers(2);
  assert.equal(g.allow(100300), true);
});

test('the recorder finder tries every address on the local network except the PC itself', () => {
  const hosts = subnetHosts('192.168.1.23', '255.255.255.0');
  assert.equal(hosts.length, 253);
  assert.equal(hosts[0], '192.168.1.1');
  assert.equal(hosts.at(-1), '192.168.1.254');
  assert.ok(!hosts.includes('192.168.1.23'));
  assert.equal(subnetHosts('10.0.5.9', '255.255.0.0').length, 253, 'a big network is cut to the PC\'s own /24');
  assert.equal(subnetHosts('10.0.5.9', '255.255.0.0')[0], '10.0.5.1');
  assert.deepEqual(subnetHosts('192.168.1.2', '255.255.255.252'), ['192.168.1.1']);
});

test('the recorder finder says which device the bridge can use', () => {
  assert.equal(describeHost([80, 554, 37777]).usable, true);
  assert.match(describeHost([80, 554, 37777]).likely, /Dahua/);
  assert.equal(describeHost([554]).usable, true);
  assert.equal(describeHost([37777]).usable, false);
  assert.match(describeHost([37777]).likely, /turn RTSP on/);
  assert.equal(describeHost([80]).usable, false);
});
