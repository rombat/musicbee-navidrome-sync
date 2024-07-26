set -e

rm -rf .dist
mkdir -p .dist
cp -r index.js package*.json lib .dist
cd .dist
npm install --omit=dev

pkg -c package.json index.js -o musicbee-navidrome-sync.exe
