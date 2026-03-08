// Platform abstraction layer
// Electron / Web 両環境で同じ ElectronAPI インターフェースを提供する

import type { ElectronAPI } from './types';

function detectEnvironment(): 'electron' | 'web' {
  return typeof window !== 'undefined' && (window as any).electronAPI ? 'electron' : 'web';
}

let _platform: ElectronAPI | null = null;

export async function initPlatform(): Promise<ElectronAPI> {
  if (_platform) return _platform;

  const env = detectEnvironment();

  if (env === 'electron') {
    const { createElectronAdapter } = await import('./electron-adapter');
    _platform = createElectronAdapter();
  } else {
    const { createWebAdapter } = await import('./web-adapter');
    _platform = await createWebAdapter();
  }

  return _platform;
}

// 同期アクセス用（initPlatform後に使う）
export function getPlatform(): ElectronAPI {
  if (!_platform) {
    // Electron環境なら即座に取得可能
    if (detectEnvironment() === 'electron') {
      _platform = (window as any).electronAPI;
      return _platform!;
    }
    throw new Error('Platform not initialized. Call initPlatform() first.');
  }
  return _platform;
}

// 便利なエクスポート: ほとんどのrendererコードはこれを使う
// Electron環境ではwindow.electronAPIが即座に利用可能なので同期で返せる
export const platform: ElectronAPI = new Proxy({} as ElectronAPI, {
  get(_target, prop) {
    const p = getPlatform();
    const val = (p as any)[prop];
    return typeof val === 'function' ? val.bind(p) : val;
  }
});
