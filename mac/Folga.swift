// Folga.app: o app de barra de menus do Mac (plano 3). Compilado por scripts/mac-app.mjs com `swiftc -O`, sem Xcode.
// Modos de linha de comando: --version (o check compara com o package.json) e --selftest (casos puros; sai 0/1).
import Foundation

let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String

func selftest() -> Int32 {
  var falhas = 0
  func caso(_ nome: String, _ ok: Bool) {
    if !ok { falhas += 1; FileHandle.standardError.write(Data("FALHOU: \(nome)\n".utf8)) }
  }
  caso("versão lida do Info.plist", version?.isEmpty == false)
  print(falhas == 0 ? "selftest: ok" : "selftest: \(falhas) falha(s)")
  return falhas == 0 ? 0 : 1
}

switch CommandLine.arguments.dropFirst().first {
case "--version": print("folga \(version ?? "?")")
case "--selftest": exit(selftest())
default:
  FileHandle.standardError.write(Data("uso: Folga --version | --selftest\n".utf8))
  exit(2)
}
