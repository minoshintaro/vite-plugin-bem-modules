# 公開版 v0.1.0 の作業状態

## 現在の状態

- `package.json` と `CHANGELOG.md` は v0.1.0 に揃っている。設計契約は [`SPEC.md`](SPEC.md)、利用方法は [`README.md`](README.md) と [`README.ja.md`](README.ja.md)、実装の責任分担は [`docs/architecture.md`](docs/architecture.md) にまとめた。
- `v0.1.0` tag と GitHub Release の本文・添付tarballは現行の公開版実装へ更新済み。npm registryへの公開は利用者が行う。
- 公開前CIは Ubuntu の Node 22.13.0 / 24、Windows と macOS の Node 24 で成功した。Ubuntu の Node 24 ではtarballを隔離consumerにインストールし、CLI、CSS・SCSS、型検査、Vite buildを確認した。
- 過去の隔離試作とrebuildの詳細な経緯はGit履歴に残す。現在の作業判断は現行コード、テスト、設計契約を正本とする。

## 次の確認

- npm公開操作とregistry上の配布確認は利用者の担当。公開前にはpackageの内容とregistry上の同名・同versionの状態を確認する。
- Windowsの実Vite watcherを使うdev E2Eは、libuv assertion回避のためskipしている。`hotUpdate`直接経路の検証と区別する。
- Vite 6 / 7 は互換性matrixを実行してからpeer rangeへの追加を判断する。現行の対象はVite 8。
- 依存packageやframework固有virtual CSS Moduleは管理対象外。対応する場合はidentity、HMR、型宣言の所有を別契約として設計する。
- 生成先がsymlinkの場合の型writer、実利用下の性能は未確認。
- GitHub ActionsのNode.js 20対象actionをNode.js 24で強制実行している警告は、各actionの対応versionを確認してから更新する。

## 既知の境界

- PostCSSではplugin配列の順序だけでvisitorの実行前後を保証できない。BEM pluginの `Once` より後でclassを追加・改名する構成は v0.1.0 の対象外。
- 同名keyframesの警告は、Viteが実際に処理した管理対象Moduleの現在状態を観測する。複数fileを順番に保存する途中には一時的な衝突警告が出ることがある。
- sourceを削除してimport解決が失敗した場合、隣接型と警告台帳は掃除するが、呼び出し側sourceの修正は利用者が行う。
- Compiler / Project の低レベルAPIはpackage rootへ公開していない。実consumerが現れた場合に公開契約を検討する。
