import assert from 'node:assert/strict';
import { join } from 'node:path';
import { dataDir, defaultSettings, MAC_NEVER_CLOSE } from '../platform.ts';
import { DEFAULT_SETTINGS } from '../types.ts';

const casos: string[] = [];
function caso(nome: string, fn: () => void) { fn(); casos.push(nome); }

caso('dataDir: darwin, win32 e FOLGA_DATA_DIR', () => {
  assert.equal(dataDir('darwin', {}, '/Users/v'), '/Users/v/Library/Application Support/Folga');
  assert.equal(dataDir('win32', { LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local' }, 'x'), join('C:\\Users\\A\\AppData\\Local', 'Folga'));
  assert.equal(dataDir('darwin', { FOLGA_DATA_DIR: '/tmp/f' }, '/Users/v'), '/tmp/f');
});

caso('defaultSettings: win32 intacto; darwin só muda neverClose', () => {
  assert.deepEqual(defaultSettings('win32'), DEFAULT_SETTINGS);
  const mac = defaultSettings('darwin');
  assert.deepEqual(mac.neverClose, MAC_NEVER_CLOSE);
  assert.ok(mac.neverClose.includes('com.apple.terminal') && mac.neverClose.includes('com.anthropic.claudefordesktop'));
  assert.ok(mac.neverClose.every(k => k === k.toLowerCase()));
  assert.deepEqual({ ...mac, neverClose: DEFAULT_SETTINGS.neverClose }, DEFAULT_SETTINGS);
});

casos.forEach((c) => console.log('ok  ' + c));
console.log(`platform: ${casos.length} casos ok`);
