const { program } = require('commander');
const { fullSync, albumsSync, artistsSync } = require('./lib/handlers/sync.js');

program.name('musicbee-navidrome-sync').description('Tools to sync MusicBee DB with Navidrome DB').version('1.0.0');

program
  .command('fullSync')
  .description('sync playcounts, track ratings, loved tracks and last played from MusicBee DB to Navidrome DB')
  .option('-u, --user <user_name>', 'choose Navidrome username (by default if not used, the first user will be used)')
  .option('-f, --first', 'run sync for the first time: add MB playcount to ND playcount')
  .option('-v, --verbose', 'verbose debugging')
  .action(fullSync);

program
  .command('albumsSync')
  .description('update all albums playcounts and ratings based on existing Navidrome DB')
  .option('-u, --user <user_name>', 'choose Navidrome username (by default if not used, the first user will be used)')
  .option('-v, --verbose', 'verbose debugging')
  .action(albumsSync);

program
  .command('artistsSync')
  .description('update all artists playcounts and ratings based on existing Navidrome DB')
  .option('-u, --user <user_name>', 'choose Navidrome username (by default if not used, the first user will be used)')
  .option('-v, --verbose', 'verbose debugging')
  .action(artistsSync);

program.parse();
