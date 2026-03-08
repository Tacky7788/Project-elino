// Claude Code CLI Bridge
// claude -p でこのCLIセッションと同じカイトに繋ぐ

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

// claude実行ファイルのフルパス
const CLAUDE_PATH = path.join(os.homedir(), '.local', 'bin', 'claude.exe');

// Electronのプロセスに不足しがちなPATHを補完した環境変数を作る
function buildEnv() {
  const env = { ...process.env };
  delete env.CLAUDECODE; // ネストセッションチェック回避
  return env;
}

class ClaudeBridge {
  constructor() {
    this.sessionId = null;
  }

  resetSession() {
    this.sessionId = null;
    console.log('[claude-bridge] セッションリセット');
  }

  getSessionId() {
    return this.sessionId;
  }

  call(prompt, onChunk) {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--verbose', '--output-format', 'stream-json', '--no-session-persistence'];

      console.log(`[claude-bridge] 呼び出し prompt長: ${prompt.length}文字`);

      const child = spawn(CLAUDE_PATH, args, {
        shell: false,
        cwd: os.homedir(),
        env: buildEnv(),
        stdio: ['ignore', 'pipe', 'pipe']  // stdin閉じる、stdout/stderrはパイプ
      });

      let fullText = '';
      let lineBuf = '';

      child.stdout.on('data', (data) => {
        lineBuf += data.toString();
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            // トークンデルタを抽出してストリーミング
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              const text = ev.delta.text;
              fullText += text;
              if (onChunk) onChunk(text);
            }
          } catch { /* JSONパース失敗は無視 */ }
        }
      });

      child.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.error('[claude-bridge stderr]', msg);
      });

      child.on('close', (code) => {
        console.log(`[claude-bridge] 終了 code=${code} text=${fullText.length}文字`);
        if (code === 0) {
          resolve(fullText.trim());
        } else {
          this.sessionId = null;
          reject(new Error(`claude exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        console.error('[claude-bridge] spawnエラー:', err.message);
        this.sessionId = null;
        reject(err);
      });
    });
  }
}

module.exports = new ClaudeBridge();
