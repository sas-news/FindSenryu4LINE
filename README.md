# 🦭 川柳検出オットセイ (FindSenryu4LINE)

<p align="center">
  <img src="./icon.png" alt="川柳検出オットセイ" width="160" />
</p>

LINEで受け取ったメッセージを形態素解析し、五・七・五（川柳・俳句）、
五・七・五・七・七（短歌）、五・七の繰り返し＋五・七・七（長歌）を検出して
返信するLINE Botです。Google Apps Script (GAS) 上で動作します。

季語が含まれる5-7-5は「俳句」、含まれない場合は「川柳」として判定されます。

### 友だち追加

[![友だち追加](https://scdn.line-apps.com/n/line_add_friends/btn/ja.png)](https://lin.ee/tKjUKJL)

LINEでこのBotを友だち追加すると、送ったメッセージから川柳や俳句、短歌、長歌を検出して返信してくれます。

## 特徴

- LINE Messaging APIのWebhookをGASの`doPost`で受信
- [Yahoo! JAPAN テキスト解析Web API（形態素解析）](https://developer.yahoo.co.jp/webapi/jlp/)による形態素解析とモーラ（拍）数のカウント
- 川柳・俳句（5-7-5）、短歌（5-7-5-7-7）、長歌（5-7の繰り返し＋5-7-7）の検出
- 季語データベース（Google Driveに保存）を用いた俳句判定・季節表示
- 検出結果に応じたリプライメッセージの自動生成

## ファイル構成

| ファイル | 内容 |
| --- | --- |
| `Code.gs` | 本体スクリプト（Webhook受信、形態素解析、詩形判定、季語判定など） |
| `appsscript.json` | GASプロジェクトのマニフェスト（Webアプリ設定など） |
| `.clasp.json` | [clasp](https://github.com/google/clasp) 用のプロジェクト設定 |

## セットアップ

### 1. 必要なもの

- Googleアカウント（Google Apps Script用）
- LINE Developersアカウント・LINE公式アカウント（Messaging API）
- Yahoo! JAPAN デベロッパーネットワークのアプリケーションID
- [clasp](https://github.com/google/clasp)（ローカルからのデプロイに使用）

### 2. clasp でプロジェクトを紐付け

```bash
npm install -g @google/clasp
clasp login
```

```bash
clasp push
```

### 3. スクリプトプロパティの設定

GASエディタの「プロジェクトの設定」→「スクリプト プロパティ」、
または`clasp`から以下のプロパティを設定してください。

| プロパティ名 | 説明 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging APIのチャネルアクセストークン |
| `YAHOO_APP_ID` | Yahoo! JAPAN テキスト解析Web APIのアプリケーションID |
| `KIGO_DB_URL` | 季語データベース（JSON）の取得元URL（`setupKigoDb()`実行時に使用） |
| `KIGO_DB_FILE_ID` | 季語DBを保存したGoogle DriveファイルのID（`setupKigoDb()`実行後に自動設定） |

### 4. 季語データベースの初期化

GASエディタで`setupKigoDb()`を一度だけ手動実行し、
季語DBをGoogle Driveに保存してください。
（`KIGO_DB_URL`の設定が事前に必要です）

### 5. Webアプリとしてデプロイ

GASエディタから「デプロイ」→「新しいデプロイ」を選択し、
種類を「ウェブアプリ」として公開します（`appsscript.json`の設定に準拠）。

発行されたWebアプリのURLを、LINE Developers ConsoleのWebhook URLに設定してください。

## 動作の流れ

1. LINEでメッセージを送信すると`doPost`がWebhookを受信
2. `detectPoetry`がYahoo! APIで形態素解析し、長歌 → 短歌 → 5-7-5の順に判定
3. 5-7-5が見つかった場合、季語データベースと照合して俳句／川柳を判別
4. `createPoetryReply`で結果に応じたリプライ文を作成
5. `replyLine`でLINEにリプライを送信

## クレジット

アイデア・名前は [u16-io/FindSenryu4Discord](https://github.com/u16-io/FindSenryu4Discord)（Discord向けの川柳検出Bot）を参考にしています。

## ライセンス

[MIT License](./LICENSE)
