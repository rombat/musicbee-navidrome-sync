set -e

rm -rf .dist
mkdir -p .dist
cp -r index.js package*.json lib .dist
cd .dist

echo "Installing dependencies..."
npm install --omit=dev --omit=optional --no-fund --loglevel=error

echo "Building MBNDS exe..."
pkg . --compress Brotli -o musicbee-navidrome-sync.exe
