// motion3.json プレイヤー
// Live2D Animation Creator が出力する Cubism4 motion3.json を再生する

// --- 型定義 ---

export interface MotionKeyframe {
  time: number;
  value: number;
  interpType: 'linear' | 'bezier' | 'step';
  cp1?: { x: number; y: number };
  cp2?: { x: number; y: number };
}

export interface ParsedMotion {
  name: string;
  duration: number;
  loop: boolean;
  curves: Map<string, MotionKeyframe[]>; // paramId -> sorted keyframes
}

export interface PlaybackEntry {
  motion: ParsedMotion;
  currentTime: number;
  weight: number;         // 0-1
  targetWeight: number;   // フェード目標
  fadeSpeed: number;      // weight/秒
  blendMode: 'additive' | 'override';
  loop: boolean;
  finished: boolean;
}

// --- motion3.json パーサー ---

export function parseMotion3Json(json: any, name = 'unnamed'): ParsedMotion {
  const curves = new Map<string, MotionKeyframe[]>();
  const duration = json.Meta?.Duration ?? 1;
  const loop = json.Meta?.Loop ?? false;

  if (!json.Curves || !Array.isArray(json.Curves)) {
    return { name, duration, loop, curves };
  }

  for (const curve of json.Curves) {
    if (curve.Target !== 'Parameter') continue;
    const pid: string = curve.Id;
    const segs: number[] = curve.Segments;
    if (!segs || segs.length < 2) continue;

    const keyframes: MotionKeyframe[] = [];

    // 最初のポイント
    keyframes.push({ time: segs[0], value: segs[1], interpType: 'linear' });

    let i = 2;
    while (i < segs.length) {
      const type = segs[i];
      i++;

      if (type === 0) {
        // リニア
        if (keyframes.length > 0) {
          keyframes[keyframes.length - 1].interpType = 'linear';
        }
        keyframes.push({ time: segs[i], value: segs[i + 1], interpType: 'linear' });
        i += 2;
      } else if (type === 1) {
        // ベジェ
        const cp1x = segs[i], cp1y = segs[i + 1];
        const cp2x = segs[i + 2], cp2y = segs[i + 3];
        const time = segs[i + 4], value = segs[i + 5];
        if (keyframes.length > 0) {
          const prev = keyframes[keyframes.length - 1];
          prev.interpType = 'bezier';
          prev.cp1 = { x: cp1x, y: cp1y };
          prev.cp2 = { x: cp2x, y: cp2y };
        }
        keyframes.push({ time, value, interpType: 'linear' });
        i += 6;
      } else if (type === 2 || type === 3) {
        // ステップ / 逆ステップ
        if (keyframes.length > 0) {
          keyframes[keyframes.length - 1].interpType = 'step';
        }
        keyframes.push({ time: segs[i], value: segs[i + 1], interpType: 'linear' });
        i += 2;
      } else {
        // 不明 → リニア扱い
        keyframes.push({ time: segs[i], value: segs[i + 1], interpType: 'linear' });
        i += 2;
      }
    }

    curves.set(pid, keyframes);
  }

  return { name, duration, loop, curves };
}

// --- 補間 ---

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function interpolate(frames: MotionKeyframe[], time: number, fallback: number): number {
  if (!frames || frames.length === 0) return fallback;
  if (time <= frames[0].time) return frames[0].value;
  if (time >= frames[frames.length - 1].time) return frames[frames.length - 1].value;

  // 二分探索
  let lo = 0, hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time <= time) lo = mid;
    else hi = mid;
  }

  const a = frames[lo], b = frames[hi];
  const dt = b.time - a.time;
  if (dt === 0) return a.value;
  const t = (time - a.time) / dt;

  if (a.interpType === 'step') return a.value;
  if (a.interpType === 'bezier' && a.cp1 && a.cp2) {
    return cubicBezier(t, a.value, a.cp1.y, a.cp2.y, b.value);
  }
  return a.value + (b.value - a.value) * t; // リニア
}

// --- MotionPlayer ---

export class MotionPlayer {
  private entries: PlaybackEntry[] = [];
  private cache = new Map<string, ParsedMotion>();

  // motion3.json をファイルから読み込んでキャッシュ
  async load(path: string, name?: string): Promise<ParsedMotion> {
    const cached = this.cache.get(path);
    if (cached) return cached;

    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load motion: ${path} (${res.status})`);
    const json = await res.json();
    const motion = parseMotion3Json(json, name ?? path.split('/').pop() ?? 'motion');
    this.cache.set(path, motion);
    return motion;
  }

  // JSON オブジェクトから直接パース
  loadFromJson(json: any, name = 'inline'): ParsedMotion {
    const motion = parseMotion3Json(json, name);
    this.cache.set(name, motion);
    return motion;
  }

  // 再生開始
  play(motion: ParsedMotion, options: {
    loop?: boolean;
    fadeIn?: number;    // フェードイン秒数（0=即座）
    weight?: number;    // 最大ウェイト（デフォルト1.0）
    blendMode?: 'additive' | 'override';
    exclusive?: boolean; // true=同ブレンドモードの他エントリを停止
  } = {}): PlaybackEntry {
    const {
      loop = motion.loop,
      fadeIn = 0.3,
      weight = 1.0,
      blendMode = 'additive',
      exclusive = true,
    } = options;

    // 排他: 同じブレンドモードの既存エントリをフェードアウト
    if (exclusive) {
      for (const e of this.entries) {
        if (e.blendMode === blendMode && !e.finished) {
          this.fadeOut(e, 0.2);
        }
      }
    }

    const entry: PlaybackEntry = {
      motion,
      currentTime: 0,
      weight: fadeIn > 0 ? 0 : weight,
      targetWeight: weight,
      fadeSpeed: fadeIn > 0 ? weight / fadeIn : 0,
      blendMode,
      loop,
      finished: false,
    };

    this.entries.push(entry);
    return entry;
  }

  // フェードアウトして停止
  fadeOut(entry: PlaybackEntry, duration = 0.3) {
    entry.targetWeight = 0;
    entry.fadeSpeed = duration > 0 ? entry.weight / duration : Infinity;
  }

  // 全停止
  stopAll(fadeDuration = 0.2) {
    for (const e of this.entries) {
      this.fadeOut(e, fadeDuration);
    }
  }

  // 毎フレーム更新: delta秒
  update(delta: number): Map<string, { value: number; mode: 'additive' | 'override' }> {
    const result = new Map<string, { value: number; mode: 'additive' | 'override' }>();

    // 終了エントリを除去
    this.entries = this.entries.filter(e => !e.finished);

    for (const entry of this.entries) {
      // 時間を進める
      entry.currentTime += delta;

      // ループ処理
      if (entry.currentTime >= entry.motion.duration) {
        if (entry.loop) {
          entry.currentTime -= entry.motion.duration;
          if (entry.currentTime > entry.motion.duration) entry.currentTime = 0;
        } else {
          entry.currentTime = entry.motion.duration;
          // 再生終了 → フェードアウト開始
          if (entry.targetWeight > 0) {
            this.fadeOut(entry, 0.2);
          }
        }
      }

      // ウェイトフェード
      if (entry.weight < entry.targetWeight) {
        entry.weight = Math.min(entry.targetWeight, entry.weight + entry.fadeSpeed * delta);
      } else if (entry.weight > entry.targetWeight) {
        entry.weight = Math.max(entry.targetWeight, entry.weight - entry.fadeSpeed * delta);
        if (entry.weight <= 0.001) {
          entry.finished = true;
          continue;
        }
      }

      // 各カーブを評価
      for (const [paramId, frames] of entry.motion.curves) {
        const value = interpolate(frames, entry.currentTime, 0);
        const weighted = value * entry.weight;

        const existing = result.get(paramId);
        if (!existing) {
          result.set(paramId, { value: weighted, mode: entry.blendMode });
        } else if (entry.blendMode === 'override') {
          // override は最後に書いたやつが勝つ
          result.set(paramId, { value: weighted, mode: 'override' });
        } else {
          // additive は加算
          existing.value += weighted;
        }
      }
    }

    return result;
  }

  // 再生中のエントリ数
  get activeCount(): number {
    return this.entries.filter(e => !e.finished).length;
  }

  // 特定モーションが再生中か
  isPlaying(name: string): boolean {
    return this.entries.some(e => !e.finished && e.motion.name === name);
  }

  // キャッシュクリア
  clearCache() {
    this.cache.clear();
  }
}
