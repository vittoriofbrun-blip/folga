import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
// @ts-ignore: JS puro, compartilhado com o smoke
import { snapshotErrors, replyErrors } from '../../scripts/contract.mjs';

const fake = join(import.meta.dirname, 'fake-probe.mjs');

function dois(env: Record<string, string>): Promise<any[]> {
  return new Promise((ok, no) => {
    const p = spawn(process.execPath, [fake], { env: { ...process.env, FAKE_INTERVAL_MS: '50', ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
    const got: any[] = [];
    const timer = setTimeout(() => { p.kill(); no(new Error('sonda falsa não respondeu')); }, 5000);
    createInterface({ input: p.stdout }).on('line', l => {
      got.push(JSON.parse(l));
      if (got.length === 2) { clearTimeout(timer); p.kill(); ok(got); }
    });
  });
}

const [win1, win2] = await dois({});
const [mac1, mac2] = await dois({ FAKE_MAC: '1' });
const txt = (e: string[]) => e.join('\n');

assert.deepEqual(snapshotErrors(win2, { prev: win1 }), []);
assert.deepEqual(snapshotErrors(mac2, { mac: true, prev: mac1 }), []);
assert.ok(mac2.processes.some((p: any) => p.name === 'com.google.Chrome' && !p.hasVisibleWindow));   // helper
const pressao = (await dois({ FAKE_MAC: '1', FAKE_PRESSURE: 'warn' }))[0];
assert.equal(pressao.memPressure, 'warn');

const { foregroundPid, ...semFg } = mac2;
assert.match(txt(snapshotErrors(semFg, { mac: true })), /foregroundPid/);
assert.match(txt(snapshotErrors({ ...mac2, memLoad: 5 }, { mac: true })), /memLoad/);
assert.match(txt(snapshotErrors({ ...mac2, memPressure: 'amarelo' }, { mac: true })), /memPressure/);
assert.match(txt(snapshotErrors({ ...win2, processes: [{ ...win2.processes[0], windowCount: 0, hasVisibleWindow: true }] })), /windowCount/);
assert.deepEqual(snapshotErrors({ ...mac2, processes: mac2.processes.map((p: any) => p.name === 'com.apple.Preview' ? { ...p, windowCount: 0, hasVisibleWindow: true } : p) }, { mac: true }), []);
assert.match(txt(snapshotErrors(mac2, { mac: true, prev: { ...mac1, processes: mac1.processes.map((p: any) => ({ ...p, cpuTimeMs: p.cpuTimeMs + 1e9 })) } })), /cpuTimeMs/);
assert.match(txt(snapshotErrors(win2, { mac: true })), /memPressure/);
assert.deepEqual(replyErrors({ type: 'reply', id: 'a', ok: true, windowsClosed: 0 }, 'a'), []);
assert.match(txt(replyErrors({ type: 'reply', id: 'b', ok: true }, 'a')), /id|windowsClosed/);

console.log('contract: ok');
