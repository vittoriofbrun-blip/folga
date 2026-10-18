// ESBOÇO (contrato do F-15): monitor de avisos, disco e apps de inicialização. A trilha F-15 substitui.
import type { DiskInfo, Emit, MemoryState, Settings, StartupApp, Warning } from './types.ts';

export type WarningsDeps = {
  getState: () => MemoryState | null;
  getSettings: () => Settings;
  probeAlive: () => boolean;
  lastAutoCareRun: () => number | null;
  emit: Emit;
};

export function createWarnings(_deps: WarningsDeps) {
  return {
    start(): void {},
    stop(): void {},
    list(): Warning[] { return []; },
    async disk(): Promise<DiskInfo[]> { return []; },
    async startupApps(): Promise<StartupApp[]> { return []; },
  };
}
export type Warnings = ReturnType<typeof createWarnings>;
