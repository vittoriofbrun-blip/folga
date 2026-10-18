// Sonda nativa do Folga (ADR 0002). Um arquivo, C# 5, compilado pelo csc.exe do Framework 4.8.
// Protocolo: uma linha JSON por mensagem. stdout = snapshots e replies; stdin = comandos close/kill.
// Sem System.Text.Json (nao existe no .NET Framework): o JSON de saida e escrito a mao.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class Probe
{
    // ---------- P/Invoke ----------
    [StructLayout(LayoutKind.Sequential)]
    struct MEMORYSTATUSEX
    {
        public uint dwLength; public uint dwMemoryLoad;
        public ulong ullTotalPhys; public ulong ullAvailPhys;
        public ulong ullTotalPageFile; public ulong ullAvailPageFile;
        public ulong ullTotalVirtual; public ulong ullAvailVirtual; public ulong ullAvailExtendedVirtual;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct PROCESSENTRY32
    {
        public uint dwSize; public uint cntUsage; public uint th32ProcessID;
        public UIntPtr th32DefaultHeapID; public uint th32ModuleID; public uint cntThreads;
        public uint th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    // PROCESS_MEMORY_COUNTERS_EX2 (Windows 10 1809+). Os campos pagos aqui sao so os que a struct exige.
    [StructLayout(LayoutKind.Sequential)]
    struct PMC_EX2
    {
        public uint cb; public uint PageFaultCount;
        public UIntPtr PeakWorkingSetSize; public UIntPtr WorkingSetSize;
        public UIntPtr QuotaPeakPagedPoolUsage; public UIntPtr QuotaPagedPoolUsage;
        public UIntPtr QuotaPeakNonPagedPoolUsage; public UIntPtr QuotaNonPagedPoolUsage;
        public UIntPtr PagefileUsage; public UIntPtr PeakPagefileUsage;
        public UIntPtr PrivateUsage; public UIntPtr PrivateWorkingSetSize;
        public ulong SharedCommitUsage;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct FILETIME { public uint lo; public uint hi; }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX m);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PROCESSENTRY32 e);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr h, uint code);
    [DllImport("kernel32.dll")] static extern bool ProcessIdToSessionId(uint pid, out uint sid);
    [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h, out FILETIME c, out FILETIME e, out FILETIME k, out FILETIME u);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool QueryFullProcessImageNameW(IntPtr h, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll", EntryPoint = "K32GetProcessMemoryInfo")]
    static extern bool GetProcessMemoryInfo(IntPtr h, ref PMC_EX2 c, uint cb);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowTextLengthW(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attr, out int value, int size);
    const uint DWMWA_CLOAKED = 14;
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong(IntPtr hwnd, int index);
    const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, WS_EX_APPWINDOW = 0x40000;

    // Regra da barra de tarefas: janela de ferramenta nao conta, a menos que peca APPWINDOW.
    static bool IsTaskbarWindow(IntPtr hwnd)
    {
        int ex = GetWindowLong(hwnd, GWL_EXSTYLE);
        return (ex & WS_EX_APPWINDOW) != 0 || (ex & WS_EX_TOOLWINDOW) == 0;
    }

    // Janelas "fantasma" do shell e de antivirus ficam visiveis mas escondidas pelo DWM (cloaked).
    // ponytail: janela em outra area de trabalho virtual tambem e cloaked; o app vira "sem janela"
    // e fica protegido (lado seguro). Usar IVirtualDesktopManager se isso incomodar.
    static bool IsCloaked(IntPtr hwnd)
    {
        int cloaked;
        return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0;
    }

    const uint TH32CS_SNAPPROCESS = 2;
    const uint PROCESS_TERMINATE = 0x0001, PROCESS_VM_READ = 0x0010, PROCESS_QUERY_LIMITED = 0x1000;
    const uint GW_OWNER = 4, WM_CLOSE = 0x0010;
    static readonly IntPtr INVALID = new IntPtr(-1);

    // ---------- estado ----------
    static readonly object outLock = new object();
    static StreamWriter stdout;
    static bool debug;
    static readonly Dictionary<string, string> descCache = new Dictionary<string, string>();
    static readonly DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public static void Main(string[] args)
    {
        int interval = 2;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--debug") debug = true;
            else if (args[i] == "--interval" && i + 1 < args.Length)
            {
                int n;
                if (int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out n)) interval = n;
                i++;
            }
        }
        if (interval < 1) interval = 1;

        stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
        stdout.NewLine = "\n";
        stdout.AutoFlush = true;

        Thread reader = new Thread(ReadCommands);
        reader.IsBackground = true;
        reader.Start();

        Stopwatch sw = new Stopwatch();
        while (true)
        {
            sw.Restart();
            try { WriteLine(BuildSnapshot()); }
            catch (Exception ex) { if (debug) Console.Error.WriteLine("snapshot erro: " + ex.Message); }
            long ms = sw.ElapsedMilliseconds;
            if (debug) Console.Error.WriteLine("leitura ms=" + ms + " privado=" + SelfPrivateMb() + "MB");
            long wait = interval * 1000L - ms;
            if (wait > 0) Thread.Sleep((int)wait);
        }
    }

    static void WriteLine(string s)
    {
        lock (outLock)
        {
            try { stdout.WriteLine(s); }
            catch (IOException) { Environment.Exit(0); }   // o Node morreu: nao viramos orfa
        }
    }

    static string SelfPrivateMb()
    {
        PMC_EX2 c = new PMC_EX2();
        c.cb = (uint)Marshal.SizeOf(typeof(PMC_EX2));
        if (!GetProcessMemoryInfo(Process.GetCurrentProcess().Handle, ref c, c.cb)) return "?";
        return (c.PrivateWorkingSetSize.ToUInt64() / 1048576.0).ToString("0.0", CultureInfo.InvariantCulture);
    }

    // ---------- janelas ----------
    // Janela de topo visivel, sem dono e com titulo (R05/R07). Devolve pid -> hwnds.
    static EnumWindowsProc enumCb;   // campo estatico: o GC nao pode coletar o delegate durante EnumWindows
    static Dictionary<uint, List<IntPtr>> VisibleWindows()
    {
        Dictionary<uint, List<IntPtr>> map = new Dictionary<uint, List<IntPtr>>();
        enumCb = delegate (IntPtr hwnd, IntPtr lp)
        {
            try
            {
                if (IsWindowVisible(hwnd) && GetWindow(hwnd, GW_OWNER) == IntPtr.Zero && GetWindowTextLengthW(hwnd) > 0 && !IsCloaked(hwnd) && IsTaskbarWindow(hwnd))
                {
                    uint pid;
                    GetWindowThreadProcessId(hwnd, out pid);
                    List<IntPtr> l;
                    if (!map.TryGetValue(pid, out l)) { l = new List<IntPtr>(); map[pid] = l; }
                    l.Add(hwnd);
                }
            }
            catch (Exception) { }
            return true;
        };
        EnumWindows(enumCb, IntPtr.Zero);
        return map;
    }

    // ---------- snapshot ----------
    static string BuildSnapshot()
    {
        MEMORYSTATUSEX ms = new MEMORYSTATUSEX();
        ms.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        GlobalMemoryStatusEx(ref ms);

        uint fgPid = 0;
        IntPtr fg = GetForegroundWindow();
        if (fg != IntPtr.Zero) GetWindowThreadProcessId(fg, out fgPid);

        Dictionary<uint, List<IntPtr>> wins = VisibleWindows();

        StringBuilder sb = new StringBuilder(64 * 1024);
        sb.Append("{\"type\":\"snapshot\",\"t\":")
          .Append(((long)(DateTime.UtcNow - epoch).TotalMilliseconds).ToString(CultureInfo.InvariantCulture))
          .Append(",\"memLoad\":").Append(ms.dwMemoryLoad.ToString(CultureInfo.InvariantCulture))
          .Append(",\"totalPhys\":").Append(ms.ullTotalPhys.ToString(CultureInfo.InvariantCulture))
          .Append(",\"availPhys\":").Append(ms.ullAvailPhys.ToString(CultureInfo.InvariantCulture))
          .Append(",\"foregroundPid\":").Append(fgPid == 0 ? "null" : fgPid.ToString(CultureInfo.InvariantCulture))
          .Append(",\"processes\":[");

        HashSet<string> alive = new HashSet<string>();
        bool first = true;
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap != INVALID && snap != IntPtr.Zero)
        {
            try
            {
                PROCESSENTRY32 e = new PROCESSENTRY32();
                e.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                bool ok = Process32FirstW(snap, ref e);
                while (ok)
                {
                    try
                    {
                        string item = ProcessJson(e, wins, alive);
                        if (!first) sb.Append(',');
                        sb.Append(item);
                        first = false;
                    }
                    catch (Exception ex) { if (debug) Console.Error.WriteLine("pid " + e.th32ProcessID + ": " + ex.Message); }
                    ok = Process32NextW(snap, ref e);
                }
            }
            finally { CloseHandle(snap); }
        }
        sb.Append("]}");

        // poda o cache de descricao de pids que sumiram
        List<string> dead = null;
        foreach (string k in descCache.Keys)
            if (!alive.Contains(k)) { if (dead == null) dead = new List<string>(); dead.Add(k); }
        if (dead != null) foreach (string k in dead) descCache.Remove(k);

        return sb.ToString();
    }

    static string ProcessJson(PROCESSENTRY32 e, Dictionary<uint, List<IntPtr>> wins, HashSet<string> alive)
    {
        uint pid = e.th32ProcessID;
        string name = e.szExeFile ?? "";
        uint sid;
        if (!ProcessIdToSessionId(pid, out sid)) sid = 0;

        ulong pws = 0, cpuMs = 0;
        bool accessible = false;
        string desc = "";

        IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED, false, pid);
        if (h != IntPtr.Zero)
        {
            try
            {
                accessible = true;
                PMC_EX2 c = new PMC_EX2();
                c.cb = (uint)Marshal.SizeOf(typeof(PMC_EX2));
                bool got = GetProcessMemoryInfo(h, ref c, c.cb);
                if (!got)
                {
                    // ponytail: so tenta VM_READ se o handle limitado nao bastou
                    IntPtr h2 = OpenProcess(PROCESS_QUERY_LIMITED | PROCESS_VM_READ, false, pid);
                    if (h2 != IntPtr.Zero)
                    {
                        try { got = GetProcessMemoryInfo(h2, ref c, c.cb); } finally { CloseHandle(h2); }
                    }
                }
                if (got) pws = c.PrivateWorkingSetSize.ToUInt64();

                FILETIME ct, et, kt, ut;
                if (GetProcessTimes(h, out ct, out et, out kt, out ut))
                {
                    ulong k = ((ulong)kt.hi << 32) | kt.lo, u = ((ulong)ut.hi << 32) | ut.lo;
                    cpuMs = (k + u) / 10000UL;   // 100 ns -> ms
                }

                string key = pid.ToString(CultureInfo.InvariantCulture) + "|" + name;
                alive.Add(key);
                if (!descCache.TryGetValue(key, out desc))
                {
                    desc = FileDescription(h);
                    descCache[key] = desc;
                }
            }
            finally { CloseHandle(h); }
        }

        StringBuilder sb = new StringBuilder(200);
        sb.Append("{\"pid\":").Append(pid.ToString(CultureInfo.InvariantCulture))
          .Append(",\"ppid\":").Append(e.th32ParentProcessID.ToString(CultureInfo.InvariantCulture))
          .Append(",\"name\":"); Str(sb, name);
        sb.Append(",\"description\":"); Str(sb, desc);
        sb.Append(",\"session\":").Append(sid.ToString(CultureInfo.InvariantCulture))
          .Append(",\"privateWorkingSet\":").Append(pws.ToString(CultureInfo.InvariantCulture))
          .Append(",\"cpuTimeMs\":").Append(cpuMs.ToString(CultureInfo.InvariantCulture))
          .Append(",\"hasVisibleWindow\":").Append(wins.ContainsKey(pid) ? "true" : "false")
          .Append(",\"accessible\":").Append(accessible ? "true" : "false")
          .Append('}');
        return sb.ToString();
    }

    // Custo alto (abre o arquivo e le o recurso de versao): so roda uma vez por pid+nome (cache).
    static string FileDescription(IntPtr h)
    {
        try
        {
            StringBuilder path = new StringBuilder(1024);
            uint size = (uint)path.Capacity;
            if (!QueryFullProcessImageNameW(h, 0, path, ref size)) return "";
            string d = FileVersionInfo.GetVersionInfo(path.ToString()).FileDescription;
            return d == null ? "" : d.Trim();
        }
        catch (Exception) { return ""; }
    }

    static void Str(StringBuilder sb, string s)
    {
        sb.Append('"');
        for (int i = 0; i < s.Length; i++)
        {
            char ch = s[i];
            if (ch == '"') sb.Append("\\\"");
            else if (ch == '\\') sb.Append("\\\\");
            else if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
            else sb.Append(ch);
        }
        sb.Append('"');
    }

    // ---------- comandos (stdin) ----------
    // ponytail: parser minimo so para o formato fixo {"type":"close"|"kill","id":"...","pids":[1,2]}.
    // Teto: campos fora de ordem funcionam, mas strings aninhadas/objetos extras nao sao entendidos.
    // Se o contrato crescer (campos novos, ids com unicode escapado), troque por JavaScriptSerializer.
    static readonly Regex reType = new Regex("\"type\"\\s*:\\s*\"(close|kill)\"", RegexOptions.Compiled);
    static readonly Regex reId = new Regex("\"id\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"", RegexOptions.Compiled);
    static readonly Regex rePids = new Regex("\"pids\"\\s*:\\s*\\[([^\\]]*)\\]", RegexOptions.Compiled);

    static void ReadCommands()
    {
        StreamReader r = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
        while (true)
        {
            string line;
            try { line = r.ReadLine(); } catch (Exception) { line = null; }
            if (line == null) Environment.Exit(0);   // stdin fechou: o Node morreu ou nos dispensou
            try { Handle(line); }
            catch (Exception ex) { if (debug) Console.Error.WriteLine("comando erro: " + ex.Message); }
        }
    }

    static void Handle(string line)
    {
        if (line.Trim().Length == 0) return;
        Match mi = reId.Match(line);
        if (!mi.Success) return;                       // sem id nao ha como responder
        string id = mi.Groups[1].Value;                // ja vem escapado como JSON; devolvido como veio
        Match mt = reType.Match(line);
        Match mp = rePids.Match(line);
        if (!mt.Success || !mp.Success) { Reply(id, false, 0); return; }

        List<uint> pids = new List<uint>();
        foreach (string p in mp.Groups[1].Value.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries))
        {
            uint v;
            if (!uint.TryParse(p.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out v)) { Reply(id, false, 0); return; }
            pids.Add(v);
        }

        if (mt.Groups[1].Value == "close")
        {
            int closed = 0;
            Dictionary<uint, List<IntPtr>> wins = VisibleWindows();
            foreach (uint pid in pids)
            {
                List<IntPtr> l;
                if (!wins.TryGetValue(pid, out l)) continue;
                foreach (IntPtr hwnd in l)
                    if (PostMessageW(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero)) closed++;
            }
            Reply(id, true, closed);
        }
        else
        {
            bool all = true;
            foreach (uint pid in pids)
            {
                IntPtr h = OpenProcess(PROCESS_TERMINATE, false, pid);
                if (h == IntPtr.Zero) { all = false; continue; }
                try { if (!TerminateProcess(h, 1)) all = false; } finally { CloseHandle(h); }
            }
            Reply(id, all, 0);
        }
    }

    static void Reply(string rawId, bool ok, int windowsClosed)
    {
        WriteLine("{\"type\":\"reply\",\"id\":\"" + rawId + "\",\"ok\":" + (ok ? "true" : "false")
            + ",\"windowsClosed\":" + windowsClosed.ToString(CultureInfo.InvariantCulture) + "}");
    }
}
