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
  foregroundPid: number | null;
  audioPids?: number[];        // pids com sessão de áudio ativa no dispositivo padrão (F-11); ausente = sonda antiga
  processes: ProbeProcess[];
};
// Node → sonda
export type ProbeCommand =
  | { type: 'close'; id: string; pids: number[] }   // WM_CLOSE em todas as janelas visíveis
  | { type: 'kill'; id: string; pids: number[] };   // só para apps em mayForceQuit (P03)
export type ProbeReply = { type: 'reply'; id: string; ok: boolean; windowsClosed: number };

// Node → interface
export type AppState = 'idle' | 'in_use' | 'protected';
export type AppReason = 'foreground' | 'audio' | 'busy' | 'recent' | 'idle'
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
  // v2
  warningsLevel: 'todos' | 'criticos';   // R27
  staleDays: number;                      // D16: "não abro há N dias"
  staleMinMB: number;                     // D16: ignora arquivos menores que isto
  agentProvider: AgentProvider;           // D14
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
  // terminais, editores e apps de agente rodam agentes e servidores; fechar mata o que está dentro (R05)
  neverClose: ['windowsterminal', 'cmd', 'powershell', 'pwsh', 'code', 'cursor', 'claude', 'antigravity ide', 'codex'],
  mayForceQuit: [],
  warningsLevel: 'todos',
  staleDays: 180,
  staleMinMB: 10,
  agentProvider: 'claude',
};

// ======================= v2: telas, avisos, arquivos, sugestões, agente =======================
export type View = 'inicio' | 'memoria' | 'arquivos' | 'assistente' | 'avisos' | 'autocare' | 'registro' | 'ajustes';

// Avisos (D15, R26, R27)
export type Severity = 'critico' | 'atencao' | 'info';
export type WarningKind = 'memoria' | 'disco' | 'travamento' | 'antivirus' | 'autocare' | 'sonda';
export type Warning = {
  id: string;              // estável por causa: 'memoria', 'disco:C:', 'travamento:chrome', 'antivirus', ...
  kind: WarningKind; severity: Severity;
  title: string; detail: string;
  view?: View;             // onde se resolve
  firstSeen: number; lastSeen: number; active: boolean;
};
export type DiskInfo = { drive: string; total: number; free: number };
export type StartupApp = { name: string; command: string; source: 'registro_usuario' | 'registro_maquina' | 'pasta_inicializar'; enabled: boolean };

// Arquivos parados (D16)
export type StaleBasis = 'acesso' | 'recentes' | 'modificacao';
export type StaleFile = {
  path: string; name: string; root: string;   // root = pasta do usuário onde foi achado
  size: number; lastUsed: number; lastModified: number; basis: StaleBasis;
};
export type StaleScan = {
  t: number; durationMs: number; roots: string[]; scanned: number; truncated: boolean;
  accessTracking: boolean; olderThanDays: number; minBytes: number;
  files: StaleFile[];      // por tamanho decrescente, no máximo 500
  totalBytes: number;      // soma de todos os achados (não só dos 500)
};

// Limpeza rápida (D17)
export type QuickCleanCategory = 'temp_usuario' | 'cache_navegador' | 'lixeira';
export type QuickCleanItem = {
  category: QuickCleanCategory; label: string; bytes: number; files: number;
  actionable: boolean;     // lixeira: false (só informação)
  note?: string;           // ex.: "Chrome aberto: feche para limpar o cache"
};

// Sugestões: o agente (ou a tela) propõe, o usuário aprova (R20–R24)
export type SuggestionKind = 'lixeira' | 'limpeza_rapida' | 'liberar_memoria';
export type SuggestionStatus = 'pendente' | 'feita' | 'ignorada' | 'falhou';
export type SuggestionItem = { id: string; label: string; detail: string; bytes: number };   // id = caminho, chave de app ou categoria
export type Suggestion = {
  id: string; t: number; source: 'agente' | 'folga';
  kind: SuggestionKind; title: string; reason: string;
  items: SuggestionItem[];   // R23: montados pelo servidor a partir do disco/estado, não do modelo
  bytes: number;             // soma recalculada pelo servidor (R21)
  status: SuggestionStatus; result?: string; doneAt?: number;
};
export type SuggestionDraft = { kind: SuggestionKind; title: string; reason: string; items: string[] };   // o que o agente ou a tela mandam

// Assistente (D14, ADR 0006)
export type AgentProvider = 'claude' | 'gpt';
export type ChatMessage = {
  id: string; role: 'user' | 'assistant'; text: string; t: number;
  provider?: AgentProvider; tools?: string[]; suggestionIds?: string[]; rejected?: string[]; error?: boolean;
};
export type Conversation = { id: string; provider: AgentProvider; sessionId: string | null; messages: ChatMessage[]; busy: boolean };
export type AgentEvent =
  | { type: 'start'; conversation: string; provider: AgentProvider }
  | { type: 'tool'; conversation: string; tool: string }
  | { type: 'text'; conversation: string; text: string }
  | { type: 'done'; conversation: string; message: ChatMessage }
  | { type: 'error'; conversation: string; error: string };

// Eventos SSE em /api/events: 'state' (MemoryState), 'warnings' (Warning[]), 'suggestions' (Suggestion[]), 'agent' (AgentEvent)
export type Emit = (event: 'warnings' | 'suggestions' | 'agent', data: unknown) => void;

// R05: sempre protegidos (nomes de executável sem .exe, minúsculos)
export const SYSTEM_PROCESSES: readonly string[] = [
  'explorer', 'dwm', 'csrss', 'winlogon', 'shellexperiencehost', 'startmenuexperiencehost',
  'searchhost', 'textinputhost', 'applicationframehost', 'lockapp',
];
