const { program } = require('commander');
const { fullSync } = require('./lib/handlers/sync.js');

program.name('musicbee-navidrome-sync').description('Tools to sync MusicBee DB with Navidrome DB').version('0.1.0');

program
  .command('sync')
  .description('sync playcount, track ratings, loved tracks and last played from MusicBee DB to Navidrome DB')
  .option('-f, --first', 'run sync for the first time: add MB playcount to ND playcount')
  // .option('-p, --path [dbPath]', 'chose db file path (default: ./data/navidrome.db)')
  .option('-v, --verbose', 'verbose debugging')
  .action(fullSync);

// TODO: add argument for user_name

program.parse();
