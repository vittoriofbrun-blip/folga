// ESBOÇO (contrato do F-17): arquivos parados, limpeza rápida e Lixeira. A trilha F-17 substitui.
import type { QuickCleanItem, Settings, StaleScan } from './types.ts';

export type FilesDeps = {
  getSettings: () => Settings;
  roots?: string[];          // testes: pastas permitidas no lugar das do usuário
  tempDirs?: string[];       // testes: temporários no lugar de %TEMP%
  cacheDirs?: string[];      // testes: caches no lugar dos dos navegadores
};

export function createFiles(_deps: FilesDeps) {
  return {
    allowedRoots(): string[] { return []; },
    last(): StaleScan | null { return null; },
    async scan(_opts: { olderThanDays?: number; minMB?: number } = {}): Promise<StaleScan> { throw new Error('em construção'); },
    async quickCleanPreview(): Promise<QuickCleanItem[]> { return []; },
    async recycle(_paths: string[]): Promise<{ ok: string[]; failed: string[] }> { throw new Error('em construção'); },
    async quickClean(): Promise<{ bytes: number; files: number; skipped: number }> { throw new Error('em construção'); },
  };
}
export type Files = ReturnType<typeof createFiles>;
