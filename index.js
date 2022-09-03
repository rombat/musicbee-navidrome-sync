const { program } = require('commander');
const { MBNDSynchronizer } = require('./lib/handlers/MBNDSynchronizer.js');

const runAction = async (options, command) => {
  const synchronizer = new MBNDSynchronizer(options);
  await synchronizer.run(command._name);
};

program
  .name('musicbee-navidrome-sync')
  .description('MusicBee to Navidrome Sync (MBNDS) : Tools to sync MusicBee DB with Navidrome DB')
  .version('1.0.0', '-v, --version', 'output the current version');

program
  .command('fullSync')
  .description('sync playcounts, track ratings, loved tracks and last played from MusicBee DB to Navidrome DB')
  .option('-u, --user <user_name>', 'choose Navidrome username (by default if not used, the first user will be used)')
  .option('-f, --first', 'run sync for the first time: add MB playcount to ND playcount')
  .option('-vv, --verbose', 'verbose debugging')
  .option(
    '--csv <path>',
    'MusicBee CSV source file path. Default: MusicBee_Export.csv, in the same folder as MBNDS',
    'MusicBee_Export.csv'
  )
  .option(
    '--db <path>',
    'Navidrome SQLITE .db source file path. Default: navidrome.db, in the same folder as MBNDS',
    'navidrome.db'
  )
  .action(runAction);

program
  .command('albumsSync')
  .description('update all albums playcounts and ratings based on existing Navidrome DB')
  .option('-u, --user <user_name>', 'choose Navidrome username (by default if not used, the first user will be used)')
  .option('-vv, --verbose', 'verbose debugging')
  .option(
    '--db <path>',
    'Navidrome SQLITE DB source file path. Default: navidrome.db, in the same folder as MBNDS',
    'navidrome.db'
  )
  .action(runAction);

program
  .command('artistsSync')
  .description('update all artists playcounts and ratings based on existing Navidrome DB')
  .option('-u, --user <user_name>', 'choose Navidrome username (by default if not used, the first user will be used)')
  .option('-vv, --verbose', 'verbose debugging')
  .option(
    '--db <path>',
    'Navidrome SQLITE DB source file path. Default: navidrome.db, in the same folder as MBNDS',
    'navidrome.db'
  )
  .action(runAction);

program.parse();
