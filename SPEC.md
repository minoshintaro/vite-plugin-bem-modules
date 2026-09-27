# v0.1.0 設計契約

この文書は、公開版 `vite-plugin-bem-modules` v0.1.0 の設計契約を定める。利用方法は [`README.md`](README.md) と [`README.ja.md`](README.ja.md)、実装の責任分担は [`docs/architecture.md`](docs/architecture.md)、未検証の範囲は [`PLANS.md`](PLANS.md) を参照する。

この契約は、class の TypeScript API と、BEM class・ID・keyframes をグローバルな CSS 名として扱うことを中心にする。依存関係やViteの処理はホスト基盤へ委譲する。

## 1. 目的と適用範囲

### 1.1 対象

- Vite が扱う `.module.css` と `.module.scss`。
- TypeScript / JavaScript からの通常の CSS Module import。source transform は行わず、利用者は Vite の CSS Modules API を使う。
- `/* @block <name> */` を持つ CSS Module の BEM class 変換。
- Sass の展開、PostCSS の実行、CSS Modules の runtime object 生成、CSS asset の bundling は Vite に委譲する。

公開版の主な出力は、変換後の CSS と、通常の CSS Modules import から得る class export である。class export の値は、ハッシュではなく生成された BEM class 名になる。

### 1.2 対象外

- JavaScript / TypeScript の import 文や component source の書き換え。
- Sass compiler、PostCSS runner、CSS Modules 実装、module graph、asset bundler の代替実装。
- class 以外の export を補完する互換層。
- BEM class 名をプロジェクト全体で一意にするための hash、prefix、または Project-wide uniqueness check。
- Vite 6 / 7への対応。初回公開版の対象は、現行`peerDependencies`と同じVite 8とする。
- 依存packageやframework固有のvirtual CSS Moduleを、管理対象Moduleとして所有すること。

## 2. 用語

- **管理対象 Module**: `@block` 宣言を持ち、公開版の BEM 変換へ入る CSS Module。
- **通常 Module**: `@block` 宣言を持たず、BEM plugin の所有外にある CSS Module。
- **class export API**: `import styles from "./Card.module.css"` で得る default styles object のうち、BEM class に対応する key と string value。公開版で安定性を保証する TypeScript API はこれである。
- **グローバル名**: CSS Modules のファイル単位の hash や scope 変換を受けず、出力 CSS にそのまま現れる class、ID、keyframes の名前。

## 3. 確定した契約

### 3.1 Module の所有判定

1. 管理対象 Module は、CSS comment の `@block` 宣言を一つ持つ。Block 名は宣言された値を使い、ファイル名から推測しない。
2. `@block` がない Module は通常 Module として Vite に委譲する。BEM の class 変換、BEM 用の export 書き換え、class-only型生成、keyframes警告の観測を適用しない。
3. `@block` の解析は CSS / SCSS の構文として行う。文字列の固定置換だけで selector、宣言値、animation 名を変換する方式は製品経路に採用しない。
4. 一つの Module に複数の `@block` がある場合は `BEM002` で拒否する。宣言がない場合は通常 Module として扱い、値が不正な場合は `BEM001` で拒否する。
5. `BEM008`の所有検査は`raw` / `inline` / `url` queryを持つsource specifierだけを解決する。通常importの不要な解決は行わず、path形式の`virtual:` / `virtual/` specifierは既存の委譲境界を維持するために例外として扱う。
6. path形式のvirtual specifierが実体path風のresolved IDへ解決された場合、そのresolved IDはsource provenanceに基づく恒久的な除外集合へ登録する。一回だけ消費するflagは使わず、同じIDを通常importが共有しても処理順に関係なく所有外とする。無効化中の登録は行わず、disabledからenabledへ戻る境界では通常の対象判定を再開する。

### 3.2 BEM class の名前

管理対象 Module の local class は、次の意味で BEM class へ投影する。`root`、Element、Modifier の分類と設定された separator を使う。

| source class | 出力 class の意味 |
| --- | --- |
| `.root` | Block 名そのもの |
| `.element` | Block 名 + Element separator + `element` |
| `.root--compact` | Block 名 + Modifier separator + `compact` |
| `.element--large` | Block 名 + Element separator + `element` + Modifier separator + `large` |

- Modifier は対応する Base class を必要とする。
- `naming.wordCase`、`naming.elementSeparator`、`naming.modifierSeparator`、`modifierOutput` で名前とModifier exportの値を設定する。
- 生成した BEM class は hash しない。plugin が class ごとに一意な suffix を付けることも必須にしない。
- 別の Module が同じ Block 名または同じ生成 class 名を使っても、既定では衝突エラーにしない。これは CSS 名をグローバルに扱うための意図した契約である。衝突時の CSS の意味は、通常のグローバル CSS の cascade に従う。

### 3.3 class の TypeScript import API

次の API を class の安定した公開面とする。

```ts
import styles from "./Card.module.css";

styles.root; // "c-card"
styles.rootCompact; // "c-card--compact"
styles.profileImage; // "c-card__profileImage"
styles.profileImageRounded; // "c-card__profileImage--rounded"
```

- runtime の styles object に存在する key だけを、TypeScript で参照できる class key として宣言する。型生成時にこの対応を保てない Vite 設定は config 解決時に拒否する。
- source の Modifier key は、CSS Modules の key 変換規則に従って flat API へ投影する。例では `root--compact` を `rootCompact` として参照できる。
- 型を生成する間、`css.modules.localsConvention` は省略時のVite既定値、`"camelCase"`、`"dashes"`をサポートする。`"camelCaseOnly"`、`"dashesOnly"`、関数形式は元のclass keyをruntime objectから除く場合があるため、`BEM004`で拒否する。`types: false`で型を生成しない場合、この型整合検査は行わない。
- class export の値は、`modifierOutput` の設定に応じて Modifier だけ、または Base と Modifier の組み合わせになる。生成 class 自体は常にグローバル名である。
- plugin は TypeScript / JavaScript source を書き換えない。default styles object の生成と import 解決は Vite の CSS Modules に任せる。
- named CSS export、class 以外の値の型、framework 固有の virtual CSS Module の型は、この class API の保証に含めない。

### 3.4 `:global` class

- `globalScope.exact` / `prefix`に一致するclassは、BEMのBase / Element / Modifierとして分類しないが、pluginのclass対応表とclass-onlyの隣接`.d.ts`には元のkeyで残す。出力名は入力名のままglobal化する。
- source に明示した `:global(.utility)`、および `:global` の scope 内にある class は、BEM class として分類・改名しない。
- `:global` class は入力の global 名を保ち、BEM の Block / Element / Modifier uniqueness の対象から外す。
- `globalScope`による分類と明示的な`:global`は同じ機能ではない。後者はpluginのclass APIへ追加しない。
- `:global` class の runtime export の有無と key の形は、Vite の CSS Modules 設定に従う。plugin は global class を local BEM class として styles object へ追加しない。
- `:global` の scope 外にある local class は、管理対象 Module である限り BEM class として扱う。`root` は `:global` によって意図的に除外されない限り Block になる。

### 3.5 ID と keyframes

- ID はグローバル名として扱う。`#dialog` を CSS Modules の local ID として hash しない。
- `@keyframes fade` と vendor prefix 付きの同等な keyframes はグローバル名として扱う。keyframes 名と `animation` / `animation-name` の参照は同じ global 名を使う。
- ID と keyframes の名前は、別ファイルとの衝突を許容する。plugin は hash、ファイル名 suffix、Block 名 prefix によって自動的に分離しない。
- ID と keyframes は class export API ではない。local CSS Modules の非class exportを再現する目的で `:export` の alias を自動生成しない。

### 3.6 非class export の境界

- 安定した TypeScript API は BEM class だけとする。
- ID、keyframes、`@value`、任意の ICSS `:export` key は、公開版の plugin が提供する class API に含めない。
- Vite や PostCSS の実装上の都合で非classの runtime key が残る場合があっても、利用者が依存できる互換契約とはしない。

### 3.7 同名 keyframes の既定警告

- 同じ名前の global keyframes が複数の入力から検出された場合、既定で警告する。
- 警告は衝突の発見を助ける情報であり、build を失敗させない。名前の変更、hash、定義の自動統合は行わない。
- 警告がないことは、プロジェクト内に衝突がないことの保証ではない。検出できる入力集合と Vite の処理順序の範囲に限って観測する。
- 最終 CSS では通常の CSS Animations の規則に従い、同名定義が実際にどの定義を使うかは CSS の出力順に依存する。plugin はその意味を独自に変更しない。

警告台帳は、Viteが実際に処理した管理対象Moduleを観測する。通常Module、依存package、virtual Moduleは検出集合へ含めない。同じfileを再処理するときは、そのfileの旧keyframes集合を現在の集合で置き換える。sourceの削除または`@block`の削除では、そのfileの登録を撤回する。

台帳はfileから現在のkeyframes集合を引く索引と、keyframes名から現在のfile集合を引く索引を持つ。同じfile内の同名定義は一件として扱い、複数fileに同名がある間だけ警告する。衝突が解消した後に古いfileを指す警告を残さない。複数fileを順番に保存する途中では、一時的な衝突を現在の状態として警告することがある。

### 3.8 PostCSS の手書き登録

- CSS Modulesを有効にして使う場合、利用者が `vite.config` の `css.postcss.plugins` に BEM 用 PostCSS plugin を一つだけ明示的に登録する。同じインスタンスの重複を含め、複数登録は `BEM010` で拒否する。`css.modules: false`では未登録を許容する。
- 利用者が同時に使う他の PostCSS plugin も同じ配列へ明示する。PostCSSのvisitor種別も実行順に影響する。BEM pluginの `Once` より後でclassを追加・改名する変換は対象外とする。
- Vite plugin は BEM 用 PostCSS plugin を自動挿入しない。自動挿入による二重実行や、利用者の PostCSS 構成を暗黙に置き換える動作は契約に含めない。
- Vite の設定解決時に BEM 用 plugin の登録を確認し、登録がない場合は起動時に失敗させる。警告だけで処理を続けない。
- `css.postcss` の inline 設定を使うと、Vite は外部 `postcss.config.*` の探索結果を使わない。inline 設定を選んだ利用者は、必要な外部 plugin も `css.postcss.plugins` へ移して明示する。

### 3.9 Vite への委譲境界

公開版の plugin が所有するのは、`@block` の所有判定、BEM class / ID / keyframes の構文ベースの変換、class API と keyframes 警告に必要な観測である。次の処理は Vite と、その設定された実装へ委譲する。

- `.module.scss` の Sass 展開。
- PostCSS plugin 配列の実行。
- CSS Modules の local / global scope と runtime styles object の生成。
- CSS asset の bundling、module graph、importer の invalidation。
- TypeScript / JavaScript の import 解決と source transform。

ホスト基盤が所有する処理をplugin側で再実装しない。Viteの公開委譲経路で必要な処理を実現できない場合は、private APIや独自互換実装へ逃げず、未対応の境界として停止し、必要な公開APIまたは設計変更を選択肢として報告する。

したがって、設計上の基本経路は「Sass を Vite で処理した後、手書き登録した PostCSS plugin で CSS 構文を変換し、その結果を Vite の CSS Modules に渡す」経路である。Vite の CSS transformer や `css.modules` の互換範囲を独自に再実装しない。

### 3.10 隣接型宣言

- 管理対象Moduleの隣接`*.module.css.d.ts`または`*.module.scss.d.ts`を、runtime exportと同じclass対応表から生成する。buildの`types: true`では PostCSS 処理中の書き込みを保留し、Vite の公開 `closeBundle` hook で反映する。成功時は`build.write: false`でも型宣言を生成する。`buildEnd`または`renderError`へ届く失敗では保留内容を破棄する。CSS Modulesの変換失敗では既存宣言が以前の内容のままになることを検証済み。Viteのprogrammatic buildは後続`writeBundle` hookの失敗を`closeBundle`へ渡さないため、その失敗時はbuild自体がrejectしても型宣言が更新済みの場合がある。この境界より後の失敗に対する型宣言保持は保証しない。反映前に全書き込み先の所有権を確認し、`BEM006`ではどの宣言も変更しない。確認後の複数file更新は、OSのI/O障害まで含むtransactionではない。devではViteのPostCSS処理が成功した時点で更新する。
- 型宣言に含めるのはclass keyだけとする。ID、keyframes、`@value`、任意の`:export` key、明示的な`:global` classは含めない。`globalScope`に一致したlocal classは元のkeyで含める。
- 生成物にはplugin所有markerを付ける。markerのない手書きfileとsymlinkは上書き・削除しない。
- 生成内容が変わらない場合はfileを書き換えない。
- Viteが処理した管理対象Moduleはdev中に生成・更新する。sourceの削除または`@block`の削除では、plugin所有の型宣言を削除する。
- importされなくなっただけでは通常の生成modeで削除しない。未import Moduleを含む全体同期と孤立生成物の内容を再計算する掃除は、明示的な同期コマンドの責務とする。`types: false`のbuildだけは、解析なしでscope内のplugin所有宣言を一括削除する。
- SCSSの型生成は、Viteの実際のSass / PostCSS pipelineを通ったclass対応表を使う。source SCSSだけを独自解析してmixin由来classを推測しない。buildStartから別のSCSS前処理を呼び出して同じModuleを二重処理しない。
- standalone CLIは対象scopeの全Moduleをside-effect importするvirtual entryを作り、Viteのprogrammatic buildを`write: false`で一度だけ実行する。SCSSのclass対応表はそのSass → PostCSS → CSS Modules pipelineからcaptureし、CLIがSass compiler、Viteの公開`preprocessCSS`、private API、独自worker lifecycleを呼び出してはならない。capture中は`types`の値やVite plugin hookの実行順にかかわらず、PostCSS pluginから隣接型を生成・更新・削除しない。`check`は型I/Oを行わず、`sync`はbuildと全出力の所有確認に成功した後のreconcile処理だけが型I/Oを行う。CIでSCSSを検査する場合はViteが利用できるSass実装を依存へ用意する。

### 3.11 dev更新とHMR

- CSS Moduleの更新配信、module graph、importerの更新はVite標準HMRへ委譲する。plugin独自のCSS HMR runtimeを実装しない。
- classの追加・削除・改名、CSS宣言値、Sass partial、keyframes名・内容の変更後も、CSS、default styles object、DOMで使うclass値を同じ変換結果へ更新できなければならない。
- pluginは通常の更新をdocument全体のreloadへ強制しない。Viteまたはframeworkが持つHMR境界を維持する。
- import中のsourceを削除してimport解決自体が失敗する場合は、通常更新のHMR保証から外す。型宣言とkeyframes台帳は削除するが、呼び出し側sourceの修正まではpluginが行わない。
## 4. APIと運用境界

### 4.1 設定API

- `naming.wordCase`、`naming.elementSeparator`、`naming.modifierSeparator`、`modifierOutput`、`types`、`project` を公開設定とする。
- `globalScope.exact` / `prefix` も公開設定とする。一致したclassはBEM分類を受けず、元の名前のままglobal化するが、class対応表とclass-onlyの隣接`.d.ts`には残る。これは明示的な`:global(...)`のclassをplugin APIへ追加することとは異なる。新規コードではCSS標準の`:global(...)`を推奨し、別名を追加してAPIを拡張しない。`root`はBlockとして扱う。
- Project-wide の一意性検査は行わない。`project.include` / `exclude` は未import Moduleを含む明示的な `check` / `sync` の範囲指定として残す。Vite companionはbuildStartで全体走査せず、`project.startup`は設定互換のため受け付けるが全体同期を起動しない。
- `bem-modules check` と `bem-modules sync` を提供する。`check` は class 構文と設定の検査、`sync` は同じ範囲の class-only 隣接型の同期を担当し、keyframes の Vite 警告台帳を CLI の永続状態にはしない。
- package root は既定 export `bemModules`、`createBemPostcssPlugin`、`defineBemModulesConfig`、`isBemGlobalClassName` と公開型を提供する。Compiler / Project / keyframes registry は内部 API とする。

### 4.2 観測範囲

- keyframes警告は、Viteが処理した管理対象Moduleだけを観測する。依存package、通常Module、virtual Moduleまで広げる場合は、file identityと削除契約を別に定める。
- buildごとの台帳はそのbuildで処理した入力から作る。dev台帳はfileの再処理とunlinkで更新する。buildをまたいだ永続状態は持たない。
- 未import Moduleの型同期はCLIの明示scopeに限定する。生成物と依存directoryは既定で走査対象から除外し、明示的に指定したinclude pathとその配下には別途scope規則を適用する。
- 複数fileを順番に保存する途中の一時的なkeyframes衝突を抑止するかは、実利用で問題が確認された場合に検討する。警告を原子的な複数file更新の保証にはしない。

### 4.3 Vite設定との共存

- `css.modules.generateScopedName` は管理対象 ModuleのBEM class名には適用しない。管理対象ではpluginがglobal化したclass名と生成した`:export`の値を使う。通常 Moduleへの Vite 標準設定は変更しない。
- `localsConvention` と `exportGlobals` は Vite に委譲する。型生成中に対応する `localsConvention` は省略時の既定値、`"camelCase"`、`"dashes"`に限る。元のsource keyを除く設定や関数形式は型の保証と両立しないため、`BEM004`で拒否する。追加aliasやglobal classのruntime exportは、引き続きVite設定の結果として扱う。
- 登録検出は、`createBemPostcssPlugin()`が返す marker付き PostCSS pluginを、解決済み `css.postcss.plugins` の配列から探す。配列の wrapperを暗黙に展開したり、他の関数を実行して推測したりしない。runtimeではCSS Modulesが有効なとき登録が一つ必要で、複数登録は無効時も含め`BEM010`で停止する。CLIはこれに加えて、解決済みVite plugin一覧に互換protocol markerを持つ`bemModules()` companionが登録されていることも必要とする。plugin名の文字列だけではcompanionと判定しない。Vite configなし、companionなし、非互換protocol、外部PostCSS設定だけ、PostCSS側の間接登録、または複数登録の場合は`BEM010`で停止する。外部PostCSS設定の探索・コピー・再構成・上書きは行わない。
- runtimeとCLIは`css.postcss.plugins`の順序をそのまま使用する。runtime側・CLI側ともBEM pluginの自動挿入、配列の再構成、外部設定の再読み込みは行わない。
- Viteの default PostCSS transformerだけを初期対象とし、`css.transformer: "lightningcss"` は `BEM011` で明示的に対象外とする。
- build / devではViteの実CSS pipelineだけをSass、PostCSS、CSS Modules、型projectionへ使う。呼び出し側がworker lifecycleを閉じられないVite公開APIをbuildStartやlibrary runtimeから直接起動しない。
- `bemModules()`と`createBemPostcssPlugin()`を同じVite設定へ登録する標準構成では、CSS Modulesが有効なときにBEM PostCSS pluginを一度だけ実行する。config解決時に複数登録を`BEM010`で拒否する。`types: true`のbuildではPostCSS中に型を保留し、Viteの公開`closeBundle`で反映するため、`build.write: false`でも型を同期する。`buildEnd`または`renderError`へ届く失敗では保留型を破棄するが、後続`writeBundle` hookの失敗は`closeBundle`へ伝わらず、型反映後にbuildが失敗する場合がある。この後段failure時の保持は保証しない。`css.modules: false`ではBEM変換、capture、Project検査、型同期を無効にし、PostCSS factory単体の`enabled`既定値`true`は変更しない。

## 5. 回帰検証の条件

次の挙動を変更するときは、該当する自動テストまたは実ブラウザ検証で確認する。

1. CSSとSCSSの管理対象Moduleで、`root`、Element、Modifier、Sass mixin由来classが同じglobal BEM classとclass export APIになること。
2. TypeScriptのdefault importと隣接`.d.ts`が、同じclass keyだけを公開すること。`modifierOutput`、`wordCase`、separator設定も含める。
3. `@block`なしのCSS / SCSS Moduleと明示的な`:global` classを、BEM変換とclass-only型生成の対象にしないこと。
4. ID、`@keyframes`、vendor prefix付きkeyframes、`animation` / `animation-name`の参照を、構文の境界を越えて誤変換しないこと。
5. 同名keyframesが複数の管理対象Moduleにある場合、警告を出しつつbuildを成功させ、変更・改名・削除後に古い登録と警告を残さないこと。
6. `vite.config`の`css.postcss.plugins`へ手書き登録した場合だけ動作し、未登録時に起動時エラーになること。他のPostCSS pluginとの相互作用を確認すること。
7. Sass、PostCSS、CSS Modules、asset bundlingをViteへ委譲し、同じPostCSS pluginを二重実行しないこと。SCSSのbuild / dev型同期は実Vite pipelineだけを使い、独自Sass compilerやbuildStartからの別`preprocessCSS`経路を持たないこと。
8. dev serverでclassの追加・削除・改名、CSS宣言値、Sass partial、keyframes名・内容の変更を、document全体のreloadへ強制せずCSSとdefault importへ反映すること。
9. source unlink、`@block`削除、手書きまたはsymlinkの`.d.ts`保護、内容不変時の書き込み抑止、未import Moduleの明示同期を確認すること。
10. 対象のVite 8でbuild、dev、ブラウザHMRを確認すること。Vite 6 / 7はpeer rangeへ追加する場合に別途matrixを実行する。
11. programmatic Vite buildとtest runnerが自然終了し、worker lifecycle leakを`process.exit`または`--test-force-exit`で隠さないこと。
