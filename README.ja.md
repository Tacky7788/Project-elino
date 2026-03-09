<p align="center">
  <img src="assets/icon.png" width="128">
</p>

<h1 align="center">ELINO</h1>

<p align="center">いつもそばにいるAIコンパニオン。</p>

<p align="center">
  <a href="https://github.com/Tacky7788/Project-elino/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Tacky7788/Project-elino?style=flat&colorA=080f12&colorB=1fa669" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat&colorA=080f12&colorB=3b82f6" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-latest-blue?style=flat&colorA=080f12&colorB=47848F&logo=electron&logoColor=white" alt="Electron">
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

ELINOはデスクトップに住むAIコンパニオン。Live2D/VRMモデルを描画し、好きなLLMに接続して、あなたと会話する。

最大の特徴は、人間のような記憶を目指していること。事実の記憶、会話の要約、関係性の変化、感情の推移——すべてローカルに保存され、忘却曲線に従って自然に想起される。何週間も前の会話を覚えていて、しばらく黙っていると気づいて話しかけてくる。

ブラウザタブの中のチャットボットじゃない。あなたのそばにいるもの。

> **Note:** ELINOはまだ開発途中のプロジェクトです。フィードバック、バグ報告、機能提案を歓迎しています。[Issue](https://github.com/Tacky7788/Project-elino/issues)や[Discussion](https://github.com/Tacky7788/Project-elino/discussions)からお気軽にどうぞ。

## ELINOの特徴

**デュアルモデル描画** -- Live2DとVRMを同じアプリで。好きなフォーマットを選んで、いつでも切り替えられる。

**リアルな感情** -- 会話のトーンを読み取り、表情やモーションにリアルタイムで反映する。スクリプトされた反応ではなく、文脈に応じた表現。

**記憶の永続化** -- あなたが話した事実、過去の会話の要約、あなたとコンパニオンの関係性の変化。すべてローカルに保存され、自動的に管理される。

**自分から話しかける** -- プロアクティブ発話により、沈黙が続くとコンパニオンから会話を始める。ランダムなノイズではなく、あなたのことを知った上での発言。

**複数の人格** -- キャラクタースロットで、まったく異なるコンパニオンを作成・切り替え可能。それぞれが独自の記憶、性格、外見を持つ。

**音声は自由に** -- Whisperで音声認識、OpenAI TTS / VOICEVOX / ブラウザTTSで読み上げ。プロバイダーに縛られない完全な音声I/O。

**配信と一緒に** -- 配信モードでYouTubeチャット（OneComme経由で他プラットフォームも対応）を読み取り、コンパニオンが視聴者と対話する。（開発中）

**VRChat対応** -- OSCベースのリップシンクと表情制御で、コンパニオンをVRChatに連れていける。

**Claude Code連携** -- 起動中のClaude Code CLIセッションに直接接続して、AI開発ワークフローを構築できる。

## クイックスタート

### 必要環境

- Node.js 18+
- npm

### インストールと起動

```bash
git clone https://github.com/Tacky7788/Project-elino.git
cd elino
npm install
```

`.env.example` を `.env` にコピーしてAPIキーを設定する（アプリ内の設定画面からも可能）。

```bash
cp .env.example .env
```

```bash
# 開発モード
npm run dev

# プロダクション
npm run build && npm start

# インストーラー作成
npm run pack
```

### 初回起動

初回起動時にセットアップウィザードが案内する。デスクトップ上のキャラクターをクリックしてチャットウィンドウを開く。設定はタスクトレイから。

## 対応LLM

- Anthropic (Claude)
- OpenAI
- Google (Gemini)
- Groq
- DeepSeek

## モデル

設定画面の「キャラクター」タブにある**参照**ボタンからモデルファイルを選択する。

| フォーマット | 説明 |
|-------------|------|
| `.model3.json` | Live2D Cubism 4 モデル |
| `.vrm` | VRM 3D アバター |
| `.zip` | 上記いずれかを含むアーカイブ（自動展開） |

### モデルの入手先

- [VRoid Hub](https://hub.vroid.com/) -- 無料VRMモデル（個別のライセンスを確認）
- [Live2D サンプルモデル](https://www.live2d.com/learn/sample/) -- 公式サンプル
- [Booth](https://booth.pm/) -- コミュニティ制作のLive2D / VRMモデル

### Live2D SDK

Live2Dモデルの表示には [Cubism SDK for Web](https://www.live2d.com/sdk/download/web/)（無料、ライセンス同意が必要）が必要。初回起動時のセットアップ画面で案内される。VRMモデルは不要。

## データ

ユーザーデータはすべて `%APPDATA%/elino/companion/` にローカル保存される。

<details>
<summary>ディレクトリ構成</summary>

```
companion/
  user.json           # ユーザー情報
  settings.json       # アプリ設定
  active.json         # スロット管理
  slots/
    {slotId}/
      profile.json    # キャラクタープロフィール
      personality.json # 性格設定
      memory.json     # 記憶データ
      state.json      # 状態
      history.jsonl   # 会話履歴
```

</details>

## アーキテクチャ

<details>
<summary>プロジェクト構成</summary>

```
elino/
  main.cjs            # Electron メインプロセス
  preload.cjs         # IPC ブリッジ
  src/
    core/             # バックエンド (brain, LLM, memory, TTS 等)
    renderer/         # フロントエンド (TypeScript)
      app.ts          # チャット UI
      character.ts    # キャラクターウィンドウ
      character-live2d.ts
      character-vrm.ts
      settings.html   # 設定画面
  public/
    live2d/models/    # モデルファイル（自動DLまたはユーザー配置）
    lib/              # Live2D SDK（ユーザー配置）
```

</details>

## 設定画面

| タブ | 内容 |
|------|------|
| LLM | モデル選択、APIキー、最大トークン数 |
| 音声 | STT/TTS エンジン選択、音声設定 |
| キャラクター | モデルタイプ、ウィンドウサイズ、FPS、解像度、モデルパス |
| 人格設定 | 名前、性格プリセット、キャラクタースロット管理 |
| プロアクティブ | 自発的発話の頻度や条件 |
| 配信 | YouTube / OneComme コメント連携（開発中） |
| Web版アクセス | ブラウザからの利用設定（開発中） |

## 制限事項

- Windows のみ対応（Electron + NSIS インストーラー）
- Live2D SDK は別途用意が必要（プロプライエタリライセンス）

## ライセンス

[MIT](LICENSE)
