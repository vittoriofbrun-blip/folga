// Folga.app: o app de barra de menus do Mac (plano 3, ADR 0007). Compilado por scripts/mac-app.mjs com
// `swiftc -O`, sem Xcode.
//   Folga             o app: ícone na barra, sobe e vigia o servidor (node de dentro do bundle)
//   Folga --version   "folga <versão>" (o check compara com o package.json)
//   Folga --selftest  casos puros; sai 0/1
import AppKit
import Foundation
import os

let bundleId = "local.folga.app"
let logger = Logger(subsystem: "local.folga.app", category: "app")
let port = 4780
let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
let resources = Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")

// MARK: - Regras puras (cobertas pelo --selftest)

/// Espera antes de subir o servidor de novo: 1, 2, 4, 8, 16 s; a 6ª queda em 10 min → nil (desiste).
/// `crashes` = horas das quedas da sequência atual, a mais nova por último.
func nextDelay(crashes: [Date], now: Date) -> TimeInterval? {
  let recentes = crashes.filter { now.timeIntervalSince($0) <= 600 }.count
  if recentes == 0 { return 0 }
  if recentes > 5 { return nil }
  return pow(2, Double(recentes - 1))
}

/// Registra uma queda. Servidor que ficou 5 min ou mais no ar zera a sequência.
func afterCrash(_ crashes: [Date], upSince: Date, now: Date) -> [Date] {
  now.timeIntervalSince(upSince) >= 300 ? [now] : crashes + [now]
}

/// Só o node de dentro do bundle (caminho relativo a Contents/Resources, gravado no folga.json). Nada de
/// /opt/homebrew, /usr/local ou ~/.nvm: pasta gravável pelo usuário levaria o Acesso Total ao Disco do Folga.
/// Exige executável e `--version` ≥ 24.
func findNode(recorded: String, resources: URL = resources) -> String? {
  if recorded.isEmpty || recorded.hasPrefix("/") { return nil }
  // links resolvidos dos dois lados: um link dentro de Resources apontando para fora não passa
  let base = resources.resolvingSymlinksInPath().standardizedFileURL.path
  let path = resources.appendingPathComponent(recorded).resolvingSymlinksInPath().standardizedFileURL.path
  guard path.hasPrefix(base + "/"), FileManager.default.isExecutableFile(atPath: path) else { return nil }
  let p = Process()
  p.executableURL = URL(fileURLWithPath: path)
  p.arguments = ["--version"]
  p.environment = [:]
  let out = Pipe()
  p.standardOutput = out
  p.standardError = FileHandle.nullDevice
  guard (try? p.run()) != nil else { return nil }
  p.waitUntilExit()
  let v = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
  let major = Int(v.dropFirst().prefix { $0.isNumber }) ?? 0
  return p.terminationStatus == 0 && v.hasPrefix("v") && major >= 24 ? path : nil
}

/// Ambiente do servidor, montado do zero: nada de NODE_OPTIONS, NODE_*, DYLD_* nem do resto do ambiente do app.
/// Entradas do PATH sem "/" na frente são relativas a Contents/Resources.
func childEnv(from env: [String: String], appPath: String, path: String, resources: URL = resources) -> [String: String] {
  var out: [String: String] = [:]
  for k in ["HOME", "LANG", "TMPDIR", "USER", "LOGNAME"] { if let v = env[k] { out[k] = v } }
  out["FOLGA_APP"] = "1"
  out["FOLGA_APP_PATH"] = appPath
  out["PATH"] = path.split(separator: ":").map { $0.hasPrefix("/") ? String($0) : resources.appendingPathComponent(String($0)).path }
    .joined(separator: ":")
  return out
}

/// server.log em acréscimo, zerado acima de 1 MB (como o launch.mjs). O app tem Acesso Total ao Disco, então
/// nunca segue link: um link plantado no lugar do log faria o Folga escrever num arquivo protegido. A pasta
/// também precisa ser pasta de verdade (lstat). Qualquer falha → sem log (melhor que não subir).
/// ponytail: só o último componente e a pasta-mãe são conferidos; pastas acima são do próprio usuário.
func openLog(at path: String) -> FileHandle {
  var st = stat()
  let dir = (path as NSString).deletingLastPathComponent
  guard lstat(dir, &st) == 0, (st.st_mode & S_IFMT) == S_IFDIR else {
    logger.error("server.log: a pasta não é uma pasta de verdade; sem log")
    return FileHandle.nullDevice
  }
  let fd = open(path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
  guard fd >= 0 else {
    logger.error("server.log não abriu (errno \(errno, privacy: .public)); sem log")
    return FileHandle.nullDevice
  }
  if fstat(fd, &st) != 0 || (st.st_mode & S_IFMT) != S_IFREG {
    close(fd)
    logger.error("server.log não é arquivo comum; sem log")
    return FileHandle.nullDevice
  }
  if st.st_size > 1_000_000 { _ = ftruncate(fd, 0) }
  return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
}

func selftest() -> Int32 {
  var falhas = 0
  func caso(_ nome: String, _ ok: Bool) {
    if !ok { falhas += 1; FileHandle.standardError.write(Data("FALHOU: \(nome)\n".utf8)) }
  }
  caso("versão lida do Info.plist", version?.isEmpty == false)

  let t0 = Date(timeIntervalSince1970: 1_000_000)
  var quedas: [Date] = []
  var esperas: [TimeInterval?] = []
  for i in 0..<6 {
    let agora = t0.addingTimeInterval(Double(i) * 10)
    quedas = afterCrash(quedas, upSince: agora.addingTimeInterval(-5), now: agora)
    esperas.append(nextDelay(crashes: quedas, now: agora))
  }
  caso("nextDelay: 1, 2, 4, 8, 16 s", esperas.prefix(5).map { $0 ?? -1 } == [1, 2, 4, 8, 16])
  caso("nextDelay: 6ª queda em 10 min desiste", esperas[5] == nil)
  caso("nextDelay: quedas de mais de 10 min atrás não contam",
       nextDelay(crashes: quedas, now: t0.addingTimeInterval(50 + 601)) == 0)
  let depois = t0.addingTimeInterval(1000)
  let zerou = afterCrash(quedas, upSince: depois.addingTimeInterval(-301), now: depois)
  caso("afterCrash: 5 min no ar zera a sequência", zerou == [depois] && nextDelay(crashes: zerou, now: depois) == 1)

  caso("findNode: caminho inexistente → nil", findNode(recorded: "folga/bin/nao-existe") == nil)
  caso("findNode: absoluto (fora do bundle) → nil", findNode(recorded: "/bin/sh") == nil)
  caso("findNode: escapar do bundle com .. → nil", findNode(recorded: "../MacOS/Folga") == nil)
  caso("findNode: o node de dentro do bundle", findNode(recorded: "folga/bin/node") != nil)

  let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("folga-selftest-\(getpid())")
  let fora = tmp.appendingPathComponent("fora")
  let res = tmp.appendingPathComponent("Resources")
  try? FileManager.default.createDirectory(at: fora, withIntermediateDirectories: true)
  try? FileManager.default.createDirectory(at: res.appendingPathComponent("folga/bin"), withIntermediateDirectories: true)
  try? FileManager.default.createSymbolicLink(atPath: res.appendingPathComponent("folga/bin/node").path,
                                              withDestinationPath: Bundle.main.resourceURL!.appendingPathComponent("folga/bin/node").path)
  caso("findNode: link dentro de Resources apontando para fora → nil", findNode(recorded: "folga/bin/node", resources: res) == nil)

  let alvo = fora.appendingPathComponent("protegido.txt")
  FileManager.default.createFile(atPath: alvo.path, contents: Data("intacto".utf8))
  let logLink = tmp.appendingPathComponent("server.log")
  try? FileManager.default.createSymbolicLink(atPath: logLink.path, withDestinationPath: alvo.path)
  let h = openLog(at: logLink.path)
  h.write(Data("vazou".utf8))
  caso("openLog: link no lugar do log não é seguido", h === FileHandle.nullDevice
       && (try? String(contentsOf: alvo, encoding: .utf8)) == "intacto")
  let real = tmp.appendingPathComponent("real.log")
  FileManager.default.createFile(atPath: real.path, contents: Data(count: 1_000_001))
  let hr = openLog(at: real.path)
  hr.write(Data("x".utf8))
  try? hr.close()
  caso("openLog: arquivo comum acima de 1 MB é zerado e recebe o acréscimo",
       (try? FileManager.default.attributesOfItem(atPath: real.path)[.size] as? Int) == 1)
  try? FileManager.default.removeItem(at: tmp)

  let env = childEnv(from: ["HOME": "/Users/v", "LANG": "pt_BR.UTF-8", "NODE_OPTIONS": "--require /tmp/x.js",
                            "DYLD_INSERT_LIBRARIES": "/tmp/x.dylib", "NODE_PATH": "/tmp", "SECRET": "s"],
                     appPath: "/A/Folga.app", path: "folga/bin:/usr/bin", resources: URL(fileURLWithPath: "/A/Folga.app/Contents/Resources"))
  caso("childEnv: só o permitido", Set(env.keys) == ["HOME", "LANG", "FOLGA_APP", "FOLGA_APP_PATH", "PATH"])
  caso("childEnv: sem NODE_OPTIONS nem DYLD_INSERT_LIBRARIES", env["NODE_OPTIONS"] == nil && env["DYLD_INSERT_LIBRARIES"] == nil)
  caso("childEnv: PATH resolvido dentro do bundle", env["PATH"] == "/A/Folga.app/Contents/Resources/folga/bin:/usr/bin")
  caso("childEnv: FOLGA_APP=1 e FOLGA_APP_PATH", env["FOLGA_APP"] == "1" && env["FOLGA_APP_PATH"] == "/A/Folga.app")

  print(falhas == 0 ? "selftest: ok" : "selftest: \(falhas) falha(s)")
  return falhas == 0 ? 0 : 1
}

// MARK: - O app

enum Porta { case livre, folgaDeFora, ocupada }

/// GET /api/settings: conexão recusada → livre; 200 → um Folga de fora do app; resto (inclusive silêncio) → ocupada.
func olharPorta() async -> Porta {
  var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/api/settings")!)
  req.timeoutInterval = 2
  do {
    let (_, resp) = try await URLSession.shared.data(for: req)
    return (resp as? HTTPURLResponse)?.statusCode == 200 ? .folgaDeFora : .ocupada
  } catch let e as URLError where e.code == .cannotConnectToHost {
    return .livre
  } catch {
    return .ocupada
  }
}

@MainActor
final class Supervisor {
  private var server: Process?
  private var crashes: [Date] = []
  private var upSince = Date()
  private var saindo = false
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let estado = NSMenuItem(title: "Iniciando…", action: nil, keyEquivalent: "")
  private let tentar = NSMenuItem(title: "O Folga parou — tentar de novo", action: #selector(tentarDeNovo), keyEquivalent: "")

  init() {
    item.button?.title = "Folga"
    let menu = NSMenu()
    menu.autoenablesItems = false
    estado.isEnabled = false
    tentar.target = self
    tentar.isHidden = true
    let sair = NSMenuItem(title: "Sair", action: #selector(sairDoApp), keyEquivalent: "q")
    sair.target = self
    for i in [estado, tentar, .separator(), sair] { menu.addItem(i) }
    item.menu = menu
  }

  private func mostrar(_ texto: String) { estado.title = texto; logger.notice("\(texto, privacy: .public)") }   // o log do sistema guarda o que o menu mostrou

  func subir() {
    Task { @MainActor in
      switch await olharPorta() {
      case .folgaDeFora: mostrar("Folga rodando fora do app")   // não supervisiona, não mata; a janela usa esse servidor
      case .ocupada: mostrar("A porta \(port) está ocupada por outro programa")   // não mata nada
      case .livre: iniciar()
      }
    }
  }

  private func iniciar() {
    guard !saindo else { return }
    let cfg = (try? JSONSerialization.jsonObject(with: Data(contentsOf: resources.appendingPathComponent("folga.json")))) as? [String: String]
    guard let node = findNode(recorded: cfg?["node"] ?? "") else {
      mostrar("O Folga precisa do Node 24. Peça para reinstalar.")   // sem laço
      return
    }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = ["--no-warnings", resources.appendingPathComponent("folga/src/server.ts").path]
    p.currentDirectoryURL = resources.appendingPathComponent("folga")
    p.environment = childEnv(from: ProcessInfo.processInfo.environment, appPath: Bundle.main.bundlePath, path: cfg?["path"] ?? "/usr/bin:/bin")
    p.standardInput = Pipe()   // o app nunca fecha: se o app cair, o pipe fecha e o servidor sai
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Folga")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let log = openLog(at: dir.appendingPathComponent("server.log").path)
    p.standardOutput = log
    p.standardError = log
    p.terminationHandler = { _ in Task { @MainActor in self.caiu() } }
    do { try p.run() } catch { mostrar("Não deu para iniciar o servidor: \(error.localizedDescription)"); return }
    server = p
    upSince = Date()
    tentar.isHidden = true
    mostrar("Folga no ar")
  }

  private func caiu() {
    server = nil
    if saindo { return }
    let agora = Date()
    crashes = afterCrash(crashes, upSince: upSince, now: agora)
    guard let espera = nextDelay(crashes: crashes, now: agora) else {
      mostrar("O servidor caiu várias vezes")
      tentar.isHidden = false
      return
    }
    mostrar("O servidor caiu; volta em \(Int(espera)) s")
    DispatchQueue.main.asyncAfter(deadline: .now() + espera) { [self] in subir() }
  }

  @objc private func tentarDeNovo() {
    crashes = []
    tentar.isHidden = true
    subir()
  }

  /// Encerra só o Process que o app criou (nunca um pid procurado): SIGTERM, 3 s, SIGKILL nesse mesmo Process.
  func parar() {
    saindo = true
    guard let p = server, p.isRunning else { return }
    p.terminate()
    let limite = Date().addingTimeInterval(3)
    while p.isRunning && Date() < limite { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
    if p.isRunning { kill(p.processIdentifier, SIGKILL) }   // isRunning logo antes: o pid ainda é do nosso filho
  }

  @objc private func sairDoApp() { parar(); NSApp.terminate(nil) }

}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  var supervisor: Supervisor?
  var sigterm: DispatchSourceSignal?

  func applicationDidFinishLaunching(_ n: Notification) {
    // app de barra sem janela: sem isto o macOS pode encerrá-lo sozinho (Automatic Termination)
    ProcessInfo.processInfo.disableAutomaticTermination("Folga vigia o servidor")
    let s = Supervisor()
    supervisor = s
    // segundo open: a outra instância avisa e sai; a janela abre na Task 3
    DistributedNotificationCenter.default().addObserver(forName: Notification.Name("\(bundleId).open"), object: nil, queue: .main) { _ in }
    signal(SIGTERM, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    src.setEventHandler { MainActor.assumeIsolated { s.parar(); exit(0) } }
    src.resume()
    sigterm = src
    s.subir()
  }

  func applicationWillTerminate(_ n: Notification) { supervisor?.parar() }
}

switch CommandLine.arguments.dropFirst().first {
case "--version": print("folga \(version ?? "?")")
case "--selftest": exit(selftest())
case nil:
  let me = ProcessInfo.processInfo.processIdentifier
  if NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).contains(where: { $0.processIdentifier != me }) {
    DistributedNotificationCenter.default().postNotificationName(Notification.Name("\(bundleId).open"), object: nil, userInfo: nil, deliverImmediately: true)
    exit(0)
  }
  MainActor.assumeIsolated {   // código de topo roda na thread principal
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
  }
default:
  FileHandle.standardError.write(Data("uso: Folga [--version | --selftest]\n".utf8))
  exit(2)
}
