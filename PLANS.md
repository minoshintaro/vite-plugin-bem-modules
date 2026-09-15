# npm公開準備

## 現在の状態

- public repositoryとGitHub Release `v0.1.0`を公開した。tagは検証済みのRelease commitを指し、`vite-plugin-bem-modules-0.1.0.tgz`をassetとして配布している。
- npm registryへの初回公開に向け、package versionを`0.1.1`へ進めて公開可能な設定へ切り替えた。npm registryへのpublish、tag、GitHub Releaseはまだ行っていない。
- npm 11の`npm publish --dry-run`を通し、75ファイルのtarballをクリーンなVite 8 projectへ`npm install`して、build・型生成・CLIを確認した。`bin`はnpm 11が補正警告を出さない`dist/cli.js`表記とする。
- Release commitではNode.js 22.13 / 24とUbuntu / Windows / macOSのCIが成功している。

## アクティブフェーズ

公開準備の差分をcommitしてCIを確認し、npm publishの実行判断を待つ。

## 今後のフェーズ

npm publish後は、具体的なconsumer、Issue、互換性要求のいずれかが生じた時点で、対象を一つに絞って計画する。

## 持ち越し

- Windowsの実Vite watcherを使うdev E2Eはlibuv assertion回避のためskipしている。`hotUpdate`直接経路は検証済みだが、CI greenをwatcher E2E完了とは扱わない。
- Vite 6 / 7は互換性matrixを実行してからpeer rangeへの追加を判断する。
- framework固有virtual CSS Moduleは、identity・HMR・`.d.ts`所有を別契約として設計する。
- HMRの追加最適化は、標準Viteで不足する正当性回帰または性能上の必要性が観測された場合だけ行う。
- Compiler / Project低レベルAPIのpackage root公開は、実consumerが現れた場合に検討する。
- GitHub ActionsがNode.js 20対象のactionをNode.js 24で強制実行している警告は、各actionの対応versionを確認してから更新する。

## 公開時に残る作業

- `CHANGELOG.md`の`0.1.1`へ公開日を入れる。
- npm accountと公開権限を確認し、`npm publish`を実行する。
- 公開された`vite-plugin-bem-modules@0.1.1`をregistryから取得できることを確認する。
- 検証済みcommitへ`v0.1.1`tagとGitHub Releaseを作成する。
