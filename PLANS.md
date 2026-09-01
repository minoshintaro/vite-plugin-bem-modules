# GitHub Release準備計画

## 現在の状態

- 敵対的レビューの指摘を修正し、回帰テストを追加した。変更は未コミットであり、次の公開gateは修正commitの互換性matrixである。
- 2026-08-31のGitHub API確認ではremote mainは`c8b62f5`で、ローカルmainの`6c5853e`は1コミット先にある。GitHub Releaseは未作成である。
- Node 24.15.0 / pnpm 11.9.0 / Vite 8.2.1で133 test、型検査、型生成例が成功した。修正後の実tarballを展開し、CLI実行権限、source map参照先、CLIとVite consumerの動作を確認した。依存は既存環境を再利用しており、クリーンインストールは未検証である。
- 公開目標はGitHub Release `v0.1.0`とする。npm publishは明示的な再開判断があるまで凍結する。
- GitHub Actionsの互換性matrixは、`c8b62f5`でNode 22.13 / 24およびUbuntu / Windows / macOSの4ジョブすべてが成功している。
- Node 20はEOLのため保証対象から外し、互換性matrixはNode 22.13 / 24を対象とする。
- `dist/`はgit管理外のため、GitHub Releaseには同じtagからbuildしたpackage tarballを添付する。

## アクティブフェーズ

### フェーズ 08：GitHub Release `v0.1.0`を作成する

- **状態:** ローカル修正・検証済み。修正commitのCIと公開gateの確認待ち。
- **目標:** 検証済みmain commitへ`v0.1.0`tagを付け、CHANGELOGをrelease notesとしてGitHub Releaseを作成する。
- **開始条件:** 修正後のcommitでローカル検証と互換性matrixが成功し、tarballをクリーン環境へインストールして利用できる。tag対象commitとremote mainを一致させ、GitHubへのpushとRelease作成に使える認証を確認する。
- **完了条件:** tagとReleaseが同じmain commitを指し、そのcommitから生成した`vite-plugin-bem-modules-0.1.0.tgz`がassetとして添付されている。
- **フォールバック:** GitHub認証またはActions logが利用できない場合、推測でworkflowを変更しない。tag・Release作成を停止し、認証復旧を外部gateとして残す。
- **対象外:** npm publish、package API拡張、Vite 6 / 7対応、framework固有virtual module対応。
- **担当チェック:**
  - 済: 修正と回帰テストを含む133 test、型検査、型生成例、実tarballのCLI・consumer検査、`c8b62f5`のNode 22.13 / 24 matrix
  - 未: 修正後commitのCI、クリーンインストール、tag対象commitのremote反映、release notesの最終確認、tagから生成する添付asset、公開URL、GitHub Release作成に使う認証
- **タスクフォルダ:** リポジトリ直下

## 今後のフェーズ

- v0.1.0のRelease完了後に、次の計画を再設定する。

## 持ち越し

- Windowsの実Vite watcherを使うdev E2Eはlibuv assertion回避のためskipしている。`hotUpdate`直接経路は検証済みであり、CI greenをwatcher E2E完了とは扱わない。
- Vite 6 / 7は互換性matrixを実行してからpeer rangeへの追加を判断する。
- framework固有virtual CSS Moduleは、identity・HMR・`.d.ts`所有を別契約として設計する。
- HMRの追加最適化は、標準Viteで不足する正当性回帰または性能上の必要性が観測された場合だけ行う。
- Compiler / Project低レベルAPIのpackage root公開は、実consumerが現れた場合に検討する。

## 未解決事項

- GitHub Release作成に使う認証の確認。
