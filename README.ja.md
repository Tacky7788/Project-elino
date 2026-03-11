<p align="center">
  <img src="assets/icon.png" width="128">
</p>

<h1 align="center">ELINO</h1>

<p align="center"><strong>いつもそばにいるAIコンパニオン。</strong></p>

<p align="center">
  <a href="https://github.com/Tacky7788/Project-elino/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Tacky7788/Project-elino?style=flat&colorA=080f12&colorB=1fa669" alt="License"></a>
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat&colorA=080f12&colorB=3b82f6" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-latest-blue?style=flat&colorA=080f12&colorB=47848F&logo=electron&logoColor=white" alt="Electron">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">中文</a>
</p>

---

ELINOはデスクトップに住むAIコンパニオン。ブラウザタブの中のチャットボットじゃない。

Live2D/VRMキャラクターを描画し、好きなLLMに接続して会話する。最後のメッセージだけじゃなく、何週間も前の会話を覚えている。しばらく黙っていると気づいて話しかけてくる。すべての記憶はローカルに保存される。

> **開発状況:** アクティブに開発中。[Issue](https://github.com/Tacky7788/Project-elino/issues)や[Discussion](https://github.com/Tacky7788/Project-elino/discussions)からフィードバック歓迎。

## 特徴

🧠 **リアルな記憶** — 4層記憶 + BM25×ベクトルのハイブリッド検索。忘却曲線、感情重み付け、ピン固定。[詳細は下へ](#記憶システム)。

🎭 **Live2D & VRM** — 1つのアプリで両方対応。いつでも切替可能、記憶と性格はそのまま。

💬 **リアルな感情表現** — AIが感情を推定し、Live2D/VRMの表情やモーションに自動反映。*（開発中）*

👄 **ハイブリッドリップシンク** — フォネームタイミング × 音声振幅。両モデルタイプで自然な口の動き。

🗣️ **自分から話しかける** — 沈黙が続くと、あなたのことを知った上で話しかける。ランダムじゃなく文脈のある発言。

🎛️ **複数のコンパニオン** — キャラクタースロットで記憶・性格・外見が独立したコンパニオンを管理。

🌱 **自己成長** — 会話を通じてコンパニオンの性格・話し方が自動で変化。変更は確認ダイアログで承認できる。

🎙️ **音声で会話** — マイクで話しかけて、声で返事が返ってくる。Whisper STT + OpenAI TTS / VOICEVOX / ブラウザTTS対応。

📡 **配信モード** — YouTubeチャット + OneComme。コンパニオンが視聴者とリアルタイムで対話。*（開発中）*

🌐 **VRChat連携** — OSCチャットボックス経由でVRChat内のプレイヤーと会話。*（開発中）*

⚡ **Claude Code連携** — 起動中のCLIセッションに直接接続してAI開発。

## 記憶システム

ELINOの記憶はチャットログではない。人間の想起に近い動作を目指した階層型検索システム。

### アーキテクチャ

| 層 | 保存内容 |
|----|---------|
| **Facts** | 名前・好み・出来事など、あなたが話した具体的な情報 |
| **Summaries** | 過去の会話の自動生成サマリー |
| **Relationship** | 関係性がどう変化してきたかのエピソード記録 |
| **Emotional State** | 6軸の内部状態、セッションをまたいで持続 |

### ハイブリッド検索

想起時に**BM25とベクトル検索を並列実行**し、RRF（Reciprocal Rank Fusion）で結果をマージ。BM25はキーワード一致、ベクトル検索は意味的類似性を捕捉。`paraphrase-multilingual-MiniLM-L12-v2`ベースで多言語に自然対応。

### 忘却曲線

記憶には**retention score（保持スコア）**があり、時間とともに減衰。頻繁に想起される記憶や感情的に強い記憶ほど遅く減衰する。重要なことは残り、些細なことは薄れる。人間と同じように。

### 感情状態（6軸）

| 軸 | 影響 |
|----|------|
| **Valence** | ポジティブ ↔ ネガティブの気分 |
| **Arousal** | エネルギーレベル — 落ち着き vs. 興奮 |
| **Dominance** | 断定的 vs. 控えめな口調 |
| **Trust** | あなたへの開放度 |
| **Curiosity** | 関心 — 質問する vs. 受け身 |
| **Fatigue** | 返答の長さとエネルギー |

話し方や振る舞いに影響し、セッションをまたいで持続する。

### ピン固定 & プライバシー

重要な記憶はピン固定で永続化。全データは `%APPDATA%/elino/` に保存、クラウド同期なし、テレメトリなし。

## クイックスタート

```bash
git clone https://github.com/Tacky7788/Project-elino.git
cd elino
npm install
cp .env.example .env   # APIキーを設定（アプリ内からも可能）
npm run dev             # 開発モードで起動
```

> 初回起動時にセットアップウィザードが案内。デスクトップのキャラをクリックしてチャット開始。設定はタスクトレイから。

<details>
<summary><strong>プロダクション & パッケージング</strong></summary>

```bash
npm run build && npm start   # プロダクション
npm run pack                 # インストーラー作成
```

</details>

### 必要環境

- Node.js 18+
- npm

## 対応LLM

| プロバイダー | モデル |
|-------------|--------|
| Anthropic | Claude 4.5 / 4 / 3.5 |
| OpenAI | GPT-4o / 4.1 / o3 |
| Google | Gemini 2.5 / 2.0 |
| Groq | Llama, Mixtral（高速推論） |
| DeepSeek | DeepSeek-V3 / R1 |

## モデル

| フォーマット | 説明 |
|-------------|------|
| `.model3.json` | Live2D Cubism 4 |
| `.vrm` | VRM 3Dアバター |
| `.zip` | いずれかの形式を含むアーカイブ（自動展開） |

**設定 > キャラクター > 参照**からモデルファイルを選択。初回起動時にサンプルモデルが自動ダウンロードされる。

**モデルの入手先:** [VRoid Hub](https://hub.vroid.com/) · [Live2Dサンプル](https://www.live2d.com/learn/sample/) · [Booth](https://booth.pm/)

> **Live2D SDK:** Live2Dモデルの表示に必要（[無料ダウンロード](https://www.live2d.com/sdk/download/web/)、ライセンス同意が必要）。セットアップウィザードで案内される。VRMは不要。

## 設定

| タブ | 内容 |
|------|------|
| LLM | モデル選択、APIキー、最大トークン数 |
| 音声 | STT/TTSエンジン、音声設定 |
| キャラクター | モデルタイプ、ウィンドウ、FPS、解像度、リップシンク |
| 人格設定 | 名前、プリセット、キャラクタースロット |
| プロアクティブ | 自発的発話の頻度と条件 |
| 配信 | YouTube / OneComme連携 *（開発中）* |
| Web版アクセス | ブラウザからのアクセス *（開発中）* |

<details>
<summary><strong>プロジェクト構成</strong></summary>

```
elino/
  main.cjs              # Electron メインプロセス
  preload.cjs           # IPC ブリッジ
  src/
    core/               # バックエンド (brain, LLM, memory, TTS)
    renderer/           # フロントエンド (TypeScript)
      app.ts            # チャットUI
      character-live2d.ts
      character-vrm.ts
      settings.html     # 設定画面（8タブ）
  public/
    live2d/models/      # モデルファイル
    lib/                # Live2D SDK
```

</details>

<details>
<summary><strong>データディレクトリ</strong></summary>

```
%APPDATA%/elino/companion/
  user.json             # ユーザー情報
  settings.json         # アプリ設定
  active.json           # スロット管理
  slots/{slotId}/
    profile.json        # キャラプロフィール
    personality.json    # 性格設定
    memory.json         # 記憶データ
    state.json          # 感情状態
    history.jsonl       # 会話履歴
```

</details>

## 制限事項

- Windowsのみ（Electron + NSIS）
- Live2D SDKは別途用意が必要（プロプライエタリライセンス）

## コントリビュート

コントリビュート歓迎！IssueやPRをお気軽にどうぞ。バグ報告、機能提案、翻訳、モデル互換性の修正など、なんでも。

## ライセンス

[MIT](LICENSE)

---

<p align="center">ELINOが気に入ったら、リポジトリに ⭐ をいただけると励みになります。</p>
