import { program } from 'commander';
import { MBNDSynchronizer } from './lib/MBNDSynchronizer.js';
import packageJson from './package.json' with { type: 'json' };

const runAction = async (options, command) => {
  const synchronizer = new MBNDSynchronizer(options);
  await synchronizer.run(command._name);
};

const commandLinesOptions = {
  csv: {
    flags: '--csv <path>',
    description: 'MusicBee CSV source file path. Default: MusicBee_Export.csv, in the same folder as MBNDS',
    defaultValue: 'MusicBee_Export.csv'
  },
  db: {
    flags: '--db <path>',
    description: 'Navidrome SQLITE .db source file path. Default: navidrome.db, in the same folder as MBNDS',
    defaultValue: 'navidrome.db'
  },
  user: {
    flags: '-u, --user <user_name>',
    description: 'choose Navidrome username (by default if not used, the first user will be used)'
  },
  datetimeFormat: {
    flags: '--datetime-format <format>',
    description: 'MusicBee CSV datetime format. Default: "DD/MM/YYYY HH:mm"',
    defaultValue: 'DD/MM/YYYY HH:mm'
  },
  verbose: {
    flags: '--verbose',
    description: 'verbose debugging'
  },
  showNotFound: {
    flags: '--show-not-found',
    description: 'output tracks that were not found in Navidrome database'
  },
  forceRatings: {
    flags: '--force-ratings',
    description: 'allow forcing rating updates even if they are lower than the rating already saved'
  }
};

program
  .name('musicbee-navidrome-sync')
  .description(
    `MusicBee to Navidrome Sync (MBNDS) : Tools to sync MusicBee DB to Navidrome DB (v${packageJson.version})\nhttps://github.com/rombat/musicbee-navidrome-sync`
  )
  .version(packageJson.version, '-v, --version', 'output the current version');

program
  .command('fullSync')
  .description('sync playcounts, track ratings, loved tracks and last played from MusicBee DB to Navidrome DB')
  .option(commandLinesOptions.user.flags, commandLinesOptions.user.description)
  .option('-f, --first', 'run sync for the first time: add MB playcount to ND playcount')
  .option(commandLinesOptions.verbose.flags, commandLinesOptions.verbose.description)
  .option(commandLinesOptions.showNotFound.flags, commandLinesOptions.showNotFound.description)
  .option(commandLinesOptions.forceRatings.flags, commandLinesOptions.forceRatings.description)
  .option(commandLinesOptions.csv.flags, commandLinesOptions.description, commandLinesOptions.defaultValue)
  .option(commandLinesOptions.db.flags, commandLinesOptions.db.description, commandLinesOptions.db.defaultValue)
  .option(
    commandLinesOptions.datetimeFormat.flags,
    commandLinesOptions.datetimeFormat.description,
    commandLinesOptions.datetimeFormat.defaultValue
  )
  .action(runAction);

program
  .command('albumsSync')
  .description('update all albums playcounts and ratings based on existing Navidrome DB')
  .option(commandLinesOptions.user.flags, commandLinesOptions.user.description)
  .option(commandLinesOptions.verbose.flags, commandLinesOptions.verbose.description)
  .option(commandLinesOptions.forceRatings.flags, commandLinesOptions.forceRatings.description)
  .option(commandLinesOptions.db.flags, commandLinesOptions.db.description, commandLinesOptions.db.defaultValue)
  .action(runAction);

program
  .command('artistsSync')
  .description('update all artists playcounts and ratings based on existing Navidrome DB')
  .option(commandLinesOptions.user.flags, commandLinesOptions.user.description)
  .option(commandLinesOptions.verbose.flags, commandLinesOptions.verbose.description)
  .option(commandLinesOptions.forceRatings.flags, commandLinesOptions.forceRatings.description)
  .option(commandLinesOptions.db.flags, commandLinesOptions.db.description, commandLinesOptions.db.defaultValue)
  .action(runAction);

program.parse();
