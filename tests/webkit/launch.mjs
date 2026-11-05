// Open the running loopback harness in an installed iPhone Simulator.
// Never downloads runtimes, changes Xcode selection, or shuts down another device.
import { spawnSync } from 'node:child_process';
const port = Number(process.env.WEBKIT_TEST_PORT || 4177);
const base = `http://127.0.0.1:${port}`;
function simctl(...args) {
  const result = spawnSync('/usr/bin/xcrun', ['simctl', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `simctl ${args.join(' ')} failed`);
  return result.stdout;
}
try {
  const response = await fetch(base);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  console.error(`Start the local server first: node tests/webkit/serve.mjs\n${error.message}`);
  process.exit(1);
}
try {
  const inventory = JSON.parse(simctl('list', 'devices', 'available', '--json'));
  const devices = Object.entries(inventory.devices).flatMap(([runtime, list]) =>
    list.filter(device => device.isAvailable && device.name.startsWith('iPhone')).map(device => ({ ...device, runtime })));
  const requested = process.env.WEBKIT_SIMULATOR_UDID;
  const preferred = devices.sort((a, b) => b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) || a.name.localeCompare(b.name));
  const device = requested ? devices.find(device => device.udid === requested) : preferred.find(device => device.state === 'Booted') || preferred[0];
  if (!device) throw new Error(requested ? `Requested iPhone Simulator ${requested} is unavailable.` : 'No installed iPhone Simulator runtime is available.');
  if (device.state !== 'Booted') simctl('boot', device.udid);
  simctl('bootstatus', device.udid, '-b');
  simctl('openurl', device.udid, `${base}/?run=1`);
  console.log(`Opened ${device.name} (${device.runtime})\nUDID: ${device.udid}\n${base}/?run=1\nResults: dist/webkit/results.json\nOpen Xcode’s Simulator or Device Hub to interact. The booted device is left running.`);
} catch (error) {
  console.error(error.message);
  console.error('CoreSimulator must be available to this shell. In a restricted agent environment, run this through the authorized command escalation; no runtime installation is attempted.');
  process.exit(1);
}
