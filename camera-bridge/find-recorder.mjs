// Finds the camera recorder (NVR/XVR) on the ground's network, so you know which address to put in bridge.json.
// Run it on the PC that will run the bridge, while it is on the same Wi-Fi or cable as the recorder:
//   node find-recorder.mjs
// It only knocks on three ports of each address on the local network (it never logs in and sends no password), and takes about 10-20 seconds.
import { networkInterfaces } from 'node:os';
import { Socket } from 'node:net';
import { subnetHosts, RECORDER_PORTS, describeHost } from './lib.mjs';

const TIMEOUT_MS = 700;
const PARALLEL = 96;

function knock(host, port) {
  return new Promise((resolve) => {
    const s = new Socket();
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(TIMEOUT_MS);
    s.once('connect', () => done(true)).once('timeout', () => done(false)).once('error', () => done(false));
    s.connect(port, host);
  });
}

const nets = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, ...a })));
if (!nets.length) { console.error('This PC is not on a network. Connect it to the same Wi-Fi or cable as the recorder and try again.'); process.exit(1); }

const jobs = [];
for (const n of nets) {
  console.log(`Looking on ${n.name} (${n.address}, netmask ${n.netmask})...`);
  for (const host of subnetHosts(n.address, n.netmask)) for (const port of RECORDER_PORTS) jobs.push({ host, port });
}
const open = new Map();
let next = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (next < jobs.length) {
    const { host, port } = jobs[next++];
    if (await knock(host, port)) open.set(host, [...(open.get(host) ?? []), port]);
  }
}));

const found = [...open.entries()].map(([host, ports]) => ({ host, ports: ports.sort((a, b) => a - b), ...describeHost(ports) })).filter((f) => f.ports.includes(554) || f.ports.includes(37777));
if (!found.length) {
  console.log('\nNo recorder found. Check the recorder is switched on and its network cable goes to the same router as this PC.');
  console.log('You can also read its address on the recorder\'s own screen: Main Menu, Network, TCP/IP (the IP Address line).');
  process.exit(1);
}
console.log('\nFound:');
for (const f of found) console.log(`  ${f.host.padEnd(16)} ports ${f.ports.join(', ').padEnd(14)} ${f.likely}`);
const best = found.find((f) => f.usable);
if (best) console.log(`\nPut this in bridge.json under "nvr": "host": "${best.host}". Open http://${best.host} in a browser to check it is the recorder's sign-in page.`);
console.log('Ask your router (or the camera installer) to keep this address fixed for the recorder (a DHCP reservation), so it does not change after a power cut.');
