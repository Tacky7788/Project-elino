const fs = require('fs');
const path = require('path');

// ディレクトリ作成
const distMain = path.join(__dirname, '../dist/main');
const distCore = path.join(__dirname, '../dist/main/core');

if (!fs.existsSync(distMain)) {
  fs.mkdirSync(distMain, { recursive: true });
}
if (!fs.existsSync(distCore)) {
  fs.mkdirSync(distCore, { recursive: true });
}

// main/*.js をコピー
const mainFiles = fs.readdirSync(path.join(__dirname, '../src/main'));
mainFiles.forEach(file => {
  if (file.endsWith('.js')) {
    fs.copyFileSync(
      path.join(__dirname, '../src/main', file),
      path.join(distMain, file)
    );
    console.log(`Copied: src/main/${file} -> dist/main/${file}`);
  }
});

// core/*.js, *.cjs をコピー
const coreFiles = fs.readdirSync(path.join(__dirname, '../src/core'));
coreFiles.forEach(file => {
  if (file.endsWith('.js') || file.endsWith('.cjs')) {
    fs.copyFileSync(
      path.join(__dirname, '../src/core', file),
      path.join(distCore, file)
    );
    console.log(`Copied: src/core/${file} -> dist/main/core/${file}`);
  }
});

console.log('✅ Main process build complete');
