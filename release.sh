set -e
VERSION=${1:-$(node -p "require('./package.json').version")}

rm -rf .dist
mkdir -p .dist
cp -r index.js package*.json lib .dist
cd .dist
npm install --omit=dev

pkg -c package.json index.js -o musicbee-navidrome-sync_${VERSION}.exe
