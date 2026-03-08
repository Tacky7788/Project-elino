import { defineConfig } from 'vite';
import path from "path";

export default defineConfig({
  root: 'src/renderer',
  publicDir: '../../public', // プロジェクトルートのpublicを参照
  base: './',
  server: {
    port: 5173,
    strictPort: true  // ポートが使用中ならエラーで停止
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'src/renderer/index.html'),
        character: path.resolve(__dirname, 'src/renderer/character.html'),
        settings: path.resolve(__dirname, 'src/renderer/settings.html'),
        'vr-overlay': path.resolve(__dirname, 'src/renderer/vr-overlay.html')
      }
    }
  },
/*  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core')
    }
  }*/
    resolve: {
        alias: {
            "@pld/cubism4": path.resolve(__dirname, "node_modules/pixi-live2d-display/dist/cubism4.js"),
        },
    },
});
