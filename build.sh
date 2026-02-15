set -e

rm -rf .dist
mkdir -p .dist

echo "Installing dependencies for bundling..."
npm install --no-fund --loglevel=error

echo "Bundling ESM to CommonJS (with all dependencies)..."
node build.config.js

cd .dist

echo "Building MBNDS exe..."
npx @yao-pkg/pkg index.cjs --public --target node22-win-x64 --compress Brotli -o musicbee-navidrome-sync.exe
