# GitHub Release後の計画

## 現在の状態

- public repositoryとGitHub Release `v0.1.0`を公開した。tagは検証済みのRelease commitを指し、`vite-plugin-bem-modules-0.1.0.tgz`をassetとして配布している。
- npm registryへの公開は凍結中であり、`package.json`の`private: true`で誤publishを防いでいる。
- Release commitではNode.js 22.13 / 24とUbuntu / Windows / macOSのCIが成功している。

## アクティブフェーズ

現在、実装フェーズはない。`v0.1.0`の利用実績から、互換性追加・virtual module対応・配布経路のどれを先に扱うべきか判断できる観測を待つ。

## 今後のフェーズ

次のフェーズは未設定とする。具体的なconsumer、Issue、互換性要求のいずれかが生じた時点で、対象を一つに絞って計画する。

## 持ち越し

- Windowsの実Vite watcherを使うdev E2Eはlibuv assertion回避のためskipしている。`hotUpdate`直接経路は検証済みだが、CI greenをwatcher E2E完了とは扱わない。
- Vite 6 / 7は互換性matrixを実行してからpeer rangeへの追加を判断する。
- framework固有virtual CSS Moduleは、identity・HMR・`.d.ts`所有を別契約として設計する。
- HMRの追加最適化は、標準Viteで不足する正当性回帰または性能上の必要性が観測された場合だけ行う。
- Compiler / Project低レベルAPIのpackage root公開は、実consumerが現れた場合に検討する。
- GitHub ActionsがNode.js 20対象のactionをNode.js 24で強制実行している警告は、各actionの対応versionを確認してから更新する。

## 次の作業

利用報告または具体的な不具合が得られたら、最小の再現と影響範囲を確認し、その観測を開始条件に次のフェーズを作る。
