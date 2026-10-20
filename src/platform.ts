import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from './types.ts';

// Bundle ids (minúsculos) que o Mac nunca fecha por padrão: terminais, editores, Claude e Codex.
export const MAC_NEVER_CLOSE: readonly string[] = [
  'com.apple.terminal', 'com.googlecode.iterm2', 'com.mitchellh.ghostty', 'dev.warp.warp-stable',
  'com.microsoft.vscode', 'com.todesktop.230313mzl4w4u92', 'com.anthropic.claudefordesktop',
  'com.openai.codex', 'com.apple.dt.xcode',
];

export function dataDir(
  platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir(),
): string {
  if (env.FOLGA_DATA_DIR) return env.FOLGA_DATA_DIR;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Folga');
  return join(env.LOCALAPPDATA ?? join(import.meta.dirname, '..'), 'Folga');
}

export function defaultSettings(platform: NodeJS.Platform = process.platform): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (platform === 'darwin') { s.neverClose = [...MAC_NEVER_CLOSE]; s.autoCareTrigger = 'pressure'; }
  return s;
}
