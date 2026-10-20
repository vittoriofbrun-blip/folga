// Sonda do Mac: mesmo protocolo da probe.cs (uma linha JSON por leitura em stdout, comandos em stdin).
// Compilar: node scripts/build-probe.mjs  ->  probe/bin/probe-mac --interval N [--debug]
// Nesta versão: memória, pressão, swap e processos agrupados por bundle. Janelas, foco, áudio e disco
// ficam false/0/null/[] (Task 5); close/kill respondem ok sem agir.
import AppKit
import Darwin

signal(SIGPIPE, SIG_IGN)

var interval = 2.0
var debug = false
do {
    let a = CommandLine.arguments
    var i = 1
    while i < a.count {
        if a[i] == "--debug" { debug = true }
        else if a[i] == "--interval", i + 1 < a.count { if let n = Int(a[i + 1]) { interval = Double(n) }; i += 1 }
        i += 1
    }
    if interval < 1 { interval = 1 }
}

func log(_ s: String) { if debug { fputs(s + "\n", stderr) } }

// Toda escrita acontece no main, então sem trava. stdout fechado = o Node morreu: não viramos órfã.
func emit(_ obj: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: obj),
          let s = String(data: d, encoding: .utf8) else { return }
    fputs(s + "\n", stdout)
    if fflush(stdout) == EOF { exit(0) }
}

// ---------- memória ----------
let pageSize: UInt64 = { var p: vm_size_t = 0; host_page_size(mach_host_self(), &p); return UInt64(p) }()
let totalPhys = ProcessInfo.processInfo.physicalMemory

func sysctlValue<T: BitwiseCopyable>(_ name: String, _ zero: T) -> T? {
    var v = zero
    var size = MemoryLayout<T>.size
    return sysctlbyname(name, &v, &size, nil, 0) == 0 ? v : nil
}

func memory() -> [String: Any] {
    var vm = vm_statistics64()
    var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &vm) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { host_statistics64(mach_host_self(), HOST_VM_INFO64, $0, &count) }
    }
    var used: UInt64 = 0
    if kr == KERN_SUCCESS {
        let pages = UInt64(vm.internal_page_count) - UInt64(min(vm.purgeable_count, vm.internal_page_count))
            + UInt64(vm.wire_count) + UInt64(vm.compressor_page_count)
        used = min(pages * pageSize, totalPhys - 1)
    }
    let avail = totalPhys - used
    let level = sysctlValue("kern.memorystatus_vm_pressure_level", Int32(0)) ?? 1
    let pressure = level >= 4 ? "critical" : level >= 2 ? "warn" : "normal"
    let swap = sysctlValue("vm.swapusage", xsw_usage())?.xsu_used ?? 0
    return [
        "totalPhys": Int64(totalPhys), "availPhys": Int64(avail),
        "memLoad": Int((Double(used) / Double(totalPhys) * 100).rounded()),
        "memPressure": pressure, "swapUsed": Int64(swap),
    ]
}

// ---------- processos ----------
let timebase: (UInt64, UInt64) = { var t = mach_timebase_info_data_t(); mach_timebase_info(&t); return (UInt64(t.numer), UInt64(t.denom)) }()

// ponytail: API privada, a mesma que o Monitor de Atividade usa; só para .xpc (WebKit do Safari). Sem ela o Safari aparece sem os processos de página.
typealias RespFn = @convention(c) (pid_t) -> pid_t
let respFn: RespFn? = dlsym(dlopen(nil, RTLD_NOW), "responsibility_get_pid_responsible_for_pid").map { unsafeBitCast($0, to: RespFn.self) }
func responsible(_ pid: pid_t) -> pid_t? { respFn.map { $0(pid) } }

func path(of pid: pid_t) -> String {
    var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
    return proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 ? String(cString: buf) : ""
}

// Dono por caminho do .app; vive entre leituras (apps não mudam de bundle id).
var ownerCache: [String: (name: String, description: String)] = [:]
func appOwner(_ path: String) -> (name: String, description: String)? {
    // o .app mais de fora: o primeiro ".app/" do caminho (helpers moram em .app dentro do .app)
    guard let r = path.range(of: ".app/") else { return nil }
    let app = String(path[..<r.lowerBound]) + ".app"
    if let o = ownerCache[app] { return o }
    let base = ((app as NSString).lastPathComponent as NSString).deletingPathExtension
    let name = Bundle(path: app)?.bundleIdentifier ?? base
    let desc = NSRunningApplication.runningApplications(withBundleIdentifier: name).first?.localizedName
        ?? ((FileManager.default.displayName(atPath: app) as NSString).deletingPathExtension)
    let o = (name: name, description: desc)
    ownerCache[app] = o
    return o
}

func process(_ pid: pid_t) -> [String: Any]? {
    // sysctl e não proc_pidinfo(PROC_PIDTBSDINFO): este falha nos processos de outro usuário (root, daemons)
    // e eles sumiriam da lista; o sysctl é o que o ps usa e enxerga todos.
    var kp = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
    guard sysctl(&mib, 4, &kp, &size, nil, 0) == 0, size > 0 else { return nil }   // sumiu no meio
    let p = path(of: pid)
    var name: String, desc = ""
    if let o = appOwner(p) { (name, desc) = o }
    else if p.contains(".xpc/"), let rp = responsible(pid), rp != pid, let o = appOwner(path(of: rp)) { (name, desc) = o }
    else if !p.isEmpty { name = (p as NSString).lastPathComponent }
    else {
        name = withUnsafeBytes(of: kp.kp_proc.p_comm) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
        if name.isEmpty { name = "pid \(pid)" }
    }

    var ru = rusage_info_v4()
    let ok = withUnsafeMutablePointer(to: &ru) {
        $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
    } == 0
    let cpuMs = ok ? (ru.ri_user_time + ru.ri_system_time) * timebase.0 / timebase.1 / 1_000_000 : 0
    return [
        "pid": Int(pid), "ppid": Int(kp.kp_eproc.e_ppid), "name": name, "description": desc, "session": Int(kp.kp_eproc.e_ucred.cr_uid),
        "privateWorkingSet": ok ? Int64(ru.ri_phys_footprint) : 0, "cpuTimeMs": Int64(cpuMs),
        "hasVisibleWindow": false, "windowCount": 0, "accessible": ok,
    ]
}

func processes() -> [[String: Any]] {
    let n = proc_listallpids(nil, 0)
    guard n > 0 else { return [] }
    var pids = [pid_t](repeating: 0, count: Int(n) + 64)
    let got = Int(proc_listallpids(&pids, Int32(pids.count * MemoryLayout<pid_t>.size)))
    return pids.prefix(max(0, got)).filter { $0 > 0 }.compactMap(process)
}

func snapshot() {
    let t0 = DispatchTime.now().uptimeNanoseconds
    var s = memory()
    s["type"] = "snapshot"
    s["t"] = Int64(Date().timeIntervalSince1970 * 1000)
    s["foregroundPid"] = NSNull()
    s["diskActive"] = NSNull()
    s["audioPids"] = [Int]()
    s["processes"] = processes()
    emit(s)
    var ri = rusage_info_v4()
    _ = withUnsafeMutablePointer(to: &ri) { $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(getpid(), RUSAGE_INFO_V4, $0) } }
    log("leitura ms=\((DispatchTime.now().uptimeNanoseconds - t0) / 1_000_000) privado=\(ri.ri_phys_footprint / 1_048_576)MB")
}

// ---------- comandos ----------
// inteiro ≥ 0 de verdade: JSON 1.5 e true também viram NSNumber
func isPid(_ v: Any) -> Bool {
    guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), !CFNumberIsFloatType(n) else { return false }
    return n.int64Value >= 0 && n.int64Value <= Int64(Int32.max)
}

func handle(_ line: String) {
    guard let d = line.data(using: .utf8),
          let cmd = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
          let id = cmd["id"] as? String else { return }   // sem id não há como responder
    let type = cmd["type"] as? String
    let pids = cmd["pids"] as? [Any]
    let valid = (type == "close" || type == "kill") && pids?.allSatisfy(isPid) == true
    // ponytail: close/kill ainda não agem (Task 5); respondem ok com 0 janelas.
    emit(["type": "reply", "id": id, "ok": valid, "windowsClosed": 0])
}

Thread {
    while let line = readLine() { DispatchQueue.main.async { handle(line) } }
    DispatchQueue.main.async { exit(0) }   // stdin fechou: o Node morreu ou nos dispensou
}.start()

snapshot()
Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in snapshot() }
RunLoop.main.run()
