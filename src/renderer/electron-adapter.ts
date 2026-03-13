// Electron adapter — preload.cjs の window.electronAPI をそのまま返す
import type { ElectronAPI } from './types';

export function createElectronAdapter(): ElectronAPI {
  // iframe内ではpreloadが適用されないので親ウィンドウから取得
  return (window as any).electronAPI || (window.parent as any)?.electronAPI;
}
