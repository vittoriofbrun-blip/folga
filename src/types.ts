// Contrato entre sonda, servidor e interface. Fonte: .claude/fluxo-infraestrutura.md

// sonda → Node (uma linha JSON por leitura)
export type ProbeProcess = {
  pid: number; ppid: number; name: string; description: string; session: number;
  privateWorkingSet: number;   // bytes (R02)
  cpuTimeMs: number;           // acumulado; o Node calcula o delta (R04)
  hasVisibleWindow: boolean;   // janela de topo visível, sem dono
  accessible: boolean;         // OpenProcess com o token do usuário funcionou
};
export type ProbeSnapshot = {
  type: 'snapshot'; t: number; memLoad: number; totalPhys: number; availPhys: number;
  foregroundPid: number | null; processes: ProbeProcess[];
};
// Node → sonda
export type ProbeCommand =
  | { type: 'close'; id: string; pids: number[] }   // WM_CLOSE em todas as janelas visíveis
  | { type: 'kill'; id: string; pids: number[] };   // só para apps em mayForceQuit (P03)
export type ProbeReply = { type: 'reply'; id: string; ok: boolean; windowsClosed: number };

// Node → interface
export type AppState = 'idle' | 'in_use' | 'protected';
export type AppReason = 'foreground' | 'busy' | 'recent' | 'idle'
  | 'no_window' | 'system' | 'never_close' | 'self' | 'other_session';
export type AppGroup = {
  key: string; name: string; pids: number[]; privateWorkingSet: number;
  cpuPercent: number; state: AppState; reason: AppReason;
  lastFocusedAt: number | null;   // epoch ms; null = nunca visto em primeiro plano
};
export type Outcome = 'fechou' | 'ficou_aberto' | 'bandeja' | 'encerrado' | 'recusado';
export type ReleaseResult = { key: string; name: string; outcome: Outcome };
export type LogEntry = {
  t: number; origin: 'manual' | 'auto'; availBefore: number; availAfter: number;
  results: ReleaseResult[];
};
export type Settings = {
  idleMinutes: number; busyCpuPercent: number; sampleSeconds: number;
  autoCareEnabled: boolean; autoCareThreshold: number; autoCareCooldownMinutes: number;
  neverClose: string[]; mayForceQuit: string[];
};
export type MemoryState = {
  t: number; memLoad: number; totalPhys: number; availPhys: number;
  apps: AppGroup[]; freed: ReleaseResult[]; settings: Settings; startedAt: number;
  autoCare: { nextEligibleAt: number | null; lastRunAt: number | null };   // preenchido no F-06
};
export type ReleaseResponse = { availBefore: number; availAfter: number; results: ReleaseResult[] };

// Padrões de .claude/requirements.md (R03, R04, R05, R10, R12, R19)
export const DEFAULT_SETTINGS: Settings = {
  idleMinutes: 30,
  busyCpuPercent: 5,
  sampleSeconds: 2,
  autoCareEnabled: false,
  autoCareThreshold: 92,
  autoCareCooldownMinutes: 10,
  // terminais e editores rodam agentes e servidores; fechar mata o que está dentro (R05)
  neverClose: ['windowsterminal', 'cmd', 'powershell', 'pwsh', 'code', 'cursor'],
  mayForceQuit: [],
};

// R05: sempre protegidos (nomes de executável sem .exe, minúsculos)
export const SYSTEM_PROCESSES: readonly string[] = [
  'explorer', 'dwm', 'csrss', 'winlogon', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'textinputhost', 'applicationframehost', 'lockapp',
];
