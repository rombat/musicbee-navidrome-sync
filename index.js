const { program } = require('commander');
const { fullSync } = require('./lib/handlers/sync.js');

program.name('musicbee-navidrome-sync').description('Tools to sync MusicBee DB with Navidrome DB').version('0.1.0');

program
  .command('sync')
  .description('sync playcount, track ratings, loved tracks and last played from MusicBee DB to Navidrome DB')
  .option('-u, --user <user_name>', 'choose username (by default if not used, the first user will be used)')
  .option('-f, --first', 'run sync for the first time: add MB playcount to ND playcount')
  .option('-v, --verbose', 'verbose debugging')
  .action(fullSync);

/**
 * TODO
 * readme
 * esm
 * refactor as a class
 * dedicated command to update albums only
 * dedicated command to update artists only
 */

program.parse();
