// Electron adapter — preload.cjs の window.electronAPI をそのまま返す
import type { ElectronAPI } from './types';

export function createElectronAdapter(): ElectronAPI {
  return (window as any).electronAPI;
}
