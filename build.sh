set -e

rm -rf .dist
mkdir -p .dist

echo "Installing dependencies for bundling..."
npm install --no-fund --loglevel=error

echo "Bundling ESM to CommonJS (with all dependencies)..."
node build.config.js

cd .dist

echo "Building MBNDS exe..."
npx @yao-pkg/pkg index.cjs --public --target node22-win-x64 --compress Brotli -o mbnds.exe

PKG_NAME=$(node -e "process.stdout.write(require('../package.json').name)")
PKG_DESC="MusicBee to Navidrome Sync"
PKG_AUTHOR=$(node -e "process.stdout.write(require('../package.json').author)")
PKG_VERSION=$(node -e "
  const v = require('../package.json').version;
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  process.stdout.write(m ? v : '0.0.0');
")
echo "Embedding metadata into MBNDS exe..."
npx resedit mbnds.exe musicbee-navidrome-sync.exe \
  --icon 1,../assets/logos/mbnds-logo-icon.ico \
  --company-name "$PKG_AUTHOR" \
  --internal-name "$PKG_NAME" \
  --product-name "$PKG_DESC" \
  --product-version "$PKG_VERSION.0" \
  --file-description "$PKG_DESC" \
  --file-version "$PKG_VERSION.0"

echo "$PKG_NAME v$PKG_VERSION built successfully."
echo "Output file: .dist/musicbee-navidrome-sync.exe"
