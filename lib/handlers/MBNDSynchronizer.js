const fs = require('node:fs');
const csv2json = require('csvtojson');
const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const pLimit = require('p-limit');
const camelCase = require('camelcase');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const duration = require('dayjs/plugin/duration');
const relativeTime = require('dayjs/plugin/relativeTime');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
dayjs.extend(customParseFormat);
dayjs.extend(duration);
dayjs.extend(relativeTime);
const cliProgress = require('cli-progress');
const path = require('node:path');

const dbManager = require('./dbManager');
const { findBestMatch } = require('../helpers/helpers');
const packageJson = require('../../package.json');

class MBNDSynchronizer {
  constructor(options, action) {
    this.REQUIRED_HEADERS = [
      '<File path>',
      '<Filename>',
      '<Folder>',
      'Last Played',
      'Play Count',
      'Rating',
      'Love',
      'Skip Count',
      'Title'
    ];
    this.paths = {
      backupFilePath: undefined,
      defaultWorkingDirectory: './',
      defaultDbFileName: 'navidrome.db',
      defaultCsvFileName: 'MusicBee_Export.csv',
      csvFilePath: undefined,
      dbFilePath: undefined
    };
    this.options = options;
    this.limit = pLimit(20);

    process.on('SIGINT', async () => await this.restoreDbFile());
    process.on('SIGTERM', async () => await this.restoreDbFile());

    this.start = dayjs();
  }

  /**
   * check/set files paths, backup DB file, connect to it and get navidrome user
   * @param action
   * @returns {Promise<void>}
   */
  initiate = async action => {
    const { options, paths } = this;
    if (Object.keys(options).length) {
      console.log(`MBNDS v${packageJson.version} running with following options:`, options);
    }

    if (action === 'fullSync') {
      paths.csvFilePath = options.csv ?? path.join(paths.defaultWorkingDirectory, paths.defaultCsvFileName);
      if (!fs.existsSync(paths.csvFilePath)) {
        throw new Error('CSV file not found');
      }
    }

    paths.dbFilePath = options.db ?? path.join(paths.defaultWorkingDirectory, paths.defaultDbFileName);
    if (!fs.existsSync(paths.dbFilePath)) {
      throw new Error('DB file not found');
    }

    if (options.datetimeFormat && !dayjs(dayjs().format(options.datetimeFormat), options.datetimeFormat).isValid()) {
      throw new Error(
        `Invalid datetime format : ${options.datetimeFormat}. Please use available formats from https://day.js.org/docs/en/display/format`
      );
    }

    this.backupDbFile();

    this.sequelize = await dbManager.init(paths.dbFilePath);

    this.user = await this.getUser();
  };

  /**
   * by default, get the first user found in ND DB if no option passed
   * @returns {Promise<void>}
   */
  getUser = async () => {
    const { sequelize, options } = this;
    const { User } = sequelize.models;
    const params = options.user ? { where: { user_name: options.user } } : undefined;
    const user = await User.findOne(params);
    if (!user) {
      throw new Error(`user ${options.user ?? ''} not found`);
    }
    return user;
  };

  backupDbFile = () => {
    const { paths } = this;
    if (!fs.existsSync('./backups')) {
      fs.mkdirSync('./backups');
    }
    paths.backupFilePath = `./backups/navidrome_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}_backup.db`;
    fs.copyFileSync(paths.dbFilePath, paths.backupFilePath);
    console.log(`DB has been backed up to ${paths.backupFilePath}`);
  };

  restoreDbFile = async () => {
    const { paths } = this;
    fs.copyFileSync(paths.backupFilePath, paths.dbFilePath);
    try {
      await this.sequelize.close();
    } catch (e) { }
    for (const ext of ['-shm', '-wal']) {
      fs.rmSync(`${paths.dbFilePath}${ext}`, { force: true });
    }
  };

  run = async action => {
    await this.initiate(action);

    try {
      switch (action) {
        case 'fullSync':
          await this.fullSync();
          break;
        case 'albumsSync':
          await this.albumsSync();
          break;
        case 'artistsSync':
          await this.artistsSync();
          break;
      }

      await this.sequelize.close();
      console.log(`${action} completed successfully ${dayjs.duration(dayjs().diff(this.start)).humanize(true)}`);
    } catch (e) {
      await this.globalErrorHander(e);
    }
  };

  globalErrorHander = async e => {
    console.error('An error as occured, restoring DB file...');
    await this.restoreDbFile();
    throw e;
  };

  /**
   * Unified CSV processing function that can either count or process tracks
   * @param {('count'|'process')} mode
   * @param {[function|null]} [trackHandler = null] - callback for handling eligible tracks
   * @param {object} [options = {}] - additional options like batchSize, totalCount, etc.
   * @param {number} [options.batchSize = 500] - batch size for processing mode
   * @param {number} [options.totalCount = null] - total count for progress tracking
   * @returns {Promise<number>} - number of processed tracks
   */
  processCsv = async (mode, trackHandler = null, options = {}) => {
    const { batchSize = 500, totalCount = null } = options;
    const { options: syncOptions, paths } = this;
    let headerProcessed = false;
    let processedCount = 0;
    let currentBatch = [];
    let progressBar = null;

    const colParser = {
      playCount: 'number',
      rating: item => {
        let rating = parseInt(item);
        if (!rating) return 0;
        if (rating > 5 && rating <= 100) {
          rating = Math.round(rating / 20);
        }
        return rating;
      },
      lastPlayed: item => (dayjs(item, syncOptions.datetimeFormat).isValid() ? dayjs(item, syncOptions.datetimeFormat).utc() : null),
      love: item => (!!item?.trim() ? 1 : 0)
    };

    if (mode === 'process') {
      if (!trackHandler) {
        throw new Error('trackHandler is required for processing mode');
      }
      if (!totalCount) {
        throw new Error('totalCount is required for processing mode');
      }

      if (!syncOptions.verbose) {
        progressBar = new cliProgress.SingleBar(
          { etaBuffer: Math.max(100, Math.floor(totalCount * 0.1)) },
          cliProgress.Presets.shades_classic
        );
      }

      colParser.albumRating = 'number';
      colParser.playCount = 'number';
      colParser.skipCount = 'number';
      colParser.dateAdded = item => (dayjs(item, syncOptions.datetimeFormat).isValid() ? dayjs(item, syncOptions.datetimeFormat).utc() : null);
      colParser.dateModified = item => (dayjs(item, syncOptions.datetimeFormat).isValid() ? dayjs(item, syncOptions.datetimeFormat).utc() : null);
    }

    progressBar?.start(totalCount, 0);
    const incrementProgress = () => progressBar?.increment();

    await csv2json({
      delimiter: 'auto',
      colParser
    })
      .preFileLine((fileLineString, lineIdx) => {
        if (lineIdx === 0 && !headerProcessed) {
          this.REQUIRED_HEADERS.map(header => {
            if (!camelCase(fileLineString).includes(camelCase(header))) {
              throw new Error(`${header} missing in your CSV headers`);
            }
          });
          headerProcessed = true;
          return camelCase(fileLineString.replace(/<|>/g, ''));
        }
        return fileLineString;
      })
      .subscribe(async track => {
        const trackEligible = !!track.playCount || !!track.rating || !!track.lastPlayed || !!track.love;
        if (!trackEligible) {
          return;
        }

        if (mode === 'count' || !trackHandler) {
          processedCount++;
          return;
        }

        currentBatch.push(track);

        if (currentBatch.length >= batchSize) {
          await trackHandler([...currentBatch], incrementProgress);
          processedCount += currentBatch.length;
          currentBatch.length = 0;
        }
      })
      .fromFile(paths.csvFilePath);

    if (mode === 'process' && currentBatch.length > 0) {
      await trackHandler(currentBatch, incrementProgress);
      processedCount += currentBatch.length;
    }

    progressBar?.stop();
    return processedCount;
  };

  fullSync = async () => {
    const { options, user, sequelize, paths, limit } = this;
    const { Track, Annotation } = sequelize.models;

    const trackIncludes = [
      {
        model: Annotation,
        as: 'trackAnnotation',
        where: {
          item_type: 'media_file',
          user_id: user.id
        },
        required: false
      }
    ];

    let trackUpdatedCount = 0;
    let notFoundTracksCount = 0;

    const totalEligibleTracks = await this.processCsv('count');
    console.log(`${paths.csvFilePath} parsed successfully, ${totalEligibleTracks} potential tracks to be updated`);

    // await new Promise(resolve => setTimeout(resolve, 200));

    await this.processCsv('process',
      /**
       * @param {object[]} trackBatch 
       * @param {function} incrementProgress 
       */
      async (trackBatch, incrementProgress) => {
        await Promise.all(
          trackBatch.map(track =>
            limit(async () => {
              incrementProgress?.();
              const foundTracks = await Track.findAll({
                where: {
                  [Op.and]: [
                    { title: track.title },
                    {
                      path: {
                        [Op.endsWith]: `${track.filename}`
                      }
                    }
                  ]
                },
                include: trackIncludes
              });
              const foundTrack = findBestMatch(track, foundTracks);

              if (!foundTrack) {
                notFoundTracksCount++;
                if (options.verbose) {
                  console.error(`track not found: ${track.filePath}`);
                }
                return;
              }

              if (options.verbose) {
                console.log(`processing track: ${track.filePath}`);
              }

              let annotation = foundTrack?.trackAnnotation;
              if (!annotation) {
                const record = {
                  item_type: 'media_file',
                  user_id: user.id,
                  item_id: foundTrack.id,
                  play_count: 0,
                  starred: 0
                };
                if (Annotation.getAttributes().ann_id) {
                  record.ann_id = randomUUID();
                }
                annotation = Annotation.build(record);
              }

              const update = {};
              if (track.rating > annotation.rating) {
                update.rating = track.rating;
              }
              if (track.love > annotation.starred) {
                update.starred = track.love;
                update.starred_at = track.lastPlayed || null;
              }
              if (track.playCount !== annotation.play_count) {
                if (track.playCount > annotation.play_count) {
                  update.play_count = track.playCount;
                }
                if (options.first && annotation.play_count + track.playCount > annotation.play_count) {
                  update.play_count = annotation.play_count + track.playCount;
                }
              }

              if (track.lastPlayed > annotation.play_date) {
                update.play_date = track.lastPlayed;
                if (!annotation.play_count && !update.play_count && !track.skipCount && !track.playCount) {
                  update.play_count = 1;
                }
              }

              if (!Object.keys(update).length) {
                return;
              }

              if (!foundTrack.trackAnnotation) {
                await annotation.save();
              }
              await annotation.update(update);
              trackUpdatedCount++;
            })
          )
        );
      }, { totalCount: totalEligibleTracks });
    console.log(`${trackUpdatedCount} tracks updated`);

    if (notFoundTracksCount > 0) {
      console.warn(`${notFoundTracksCount} tracks not found`);
    }

    await this.albumsSync();

    await this.artistsSync();
  };

  /**
   * @param {Set<string>|null} albumsToUpdate
   * @returns {Promise<*[]>}
   */
  albumsSync = async (albumsToUpdate = null) => {
    const { options, user, sequelize, limit } = this;
    const { Track, Annotation, Album } = sequelize.models;
    let albumUpdatedCount = 0;
    const params = {
      include: [
        {
          model: Annotation,
          as: 'albumAnnotation',
          where: {
            item_type: 'album',
            user_id: user.id
          },
          required: false
        },
        {
          model: Track,
          as: 'tracks',
          include: {
            model: Annotation,
            as: 'trackAnnotation',
            where: {
              item_type: 'media_file',
              user_id: user.id
            },
            required: false
          }
        }
      ]
    };
    if (albumsToUpdate?.size) {
      params.where = {
        id: [...albumsToUpdate]
      };
    }
    const albums = await Album.findAll(params);

    console.log('Processing albums...');
    const progressBar = options.verbose
      ? null
      : new cliProgress.SingleBar(
        { etaBuffer: Math.max(100, Math.floor(albums.length * 0.1)) },
        cliProgress.Presets.shades_classic
      );
    progressBar?.start(albums.length, 0);
    await Promise.all(
      albums
        .filter(album => album.tracks.length)
        .map(album =>
          limit(async () => {
            progressBar?.increment();
            if (options.verbose) {
              console.log(`processing album ${album.name} by ${album.album_artist}`);
            }
            let annotation = album?.albumAnnotation;
            if (!annotation) {
              const record = {
                item_type: 'album',
                user_id: user.id,
                item_id: album.id,
                play_count: 0,
                starred: 0
              };

              if (Annotation.getAttributes().ann_id) {
                record.ann_id = randomUUID();
              }
              annotation = Annotation.build(record);
            }

            const update = {};
            const totalTracks = album.tracks.length;
            const totalPlaycount = album.tracks.reduce((acc, current) => {
              return acc + (current.trackAnnotation?.play_count || 0);
            }, 0);

            if (totalPlaycount > annotation.play_count) {
              update.play_count = totalPlaycount;
            }
            const ratings = album.tracks.reduce((acc, current) => {
              if (current.trackAnnotation?.rating) {
                acc.push(current.trackAnnotation.rating);
              }
              return acc;
            }, []);

            if (ratings.length > totalTracks * 0.5) {
              const albumRating = Math.round(ratings.reduce((acc, current) => acc + current, 0) / ratings.length);
              if (albumRating > annotation.rating) {
                update.rating = albumRating;
              }
            }

            const lastPlayed = album.tracks.reduce((acc, current) => {
              return current.trackAnnotation?.play_date > acc ? current.trackAnnotation.play_date : acc;
            }, null);
            if (lastPlayed > annotation.play_date) {
              update.play_date = lastPlayed;
            }

            if (!Object.keys(update).length) {
              return;
            }
            if (!album.albumAnnotation) {
              await annotation.save();
            }
            await annotation.update(update);
            albumUpdatedCount++;
          })
        )
    );
    progressBar?.stop();
    console.log(`${albumUpdatedCount} albums updated`);
    return albumUpdatedCount;
  };

  /**
   * @param {Set<string>|null} artistsToUpdate
   * @returns {Promise<*[]>}
   */
  artistsSync = async (artistsToUpdate = null) => {
    const { options, user, sequelize, limit } = this;
    const { Track, Annotation, Artist } = sequelize.models;
    let artistUpdatedCount = 0;
    const params = {
      include: [
        {
          model: Annotation,
          as: 'artistAnnotation',
          where: {
            item_type: 'artist',
            user_id: user.id
          },
          required: false
        },
        {
          model: Track,
          as: 'tracks',
          include: {
            model: Annotation,
            as: 'trackAnnotation',
            where: {
              item_type: 'media_file',
              user_id: user.id
            },
            required: false
          }
        }
      ]
    };
    if (artistsToUpdate?.size) {
      params.where = {
        id: [...artistsToUpdate]
      };
    }
    let artists = await Artist.findAll(params);
    artists = artists.filter(artist => artist.tracks.length);

    console.log('Processing artists...');
    const progressBar = options.verbose
      ? null
      : new cliProgress.SingleBar(
        { etaBuffer: Math.max(100, Math.floor(artists.length * 0.1)) },
        cliProgress.Presets.shades_classic
      );
    progressBar?.start(artists.length, 0);
    await Promise.all(
      artists.map(artist =>
        limit(async () => {
          progressBar?.increment();
          if (options.verbose) {
            console.log(`processing artist ${artist.name}`);
          }

          let annotation = artist?.artistAnnotation;
          if (!annotation) {
            const record = {
              item_type: 'artist',
              user_id: user.id,
              item_id: artist.id,
              play_count: 0,
              starred: 0
            };

            if (Annotation.getAttributes().ann_id) {
              record.ann_id = randomUUID();
            }
            annotation = Annotation.build(record);
          }
          const update = {};
          const totalPlaycount = artist.tracks.reduce((acc, current) => {
            return acc + (current.trackAnnotation?.play_count || 0);
          }, 0);

          if (totalPlaycount > annotation.play_count) {
            update.play_count = totalPlaycount;
          }
          const ratings = artist.tracks.reduce((acc, current) => {
            if (current.trackAnnotation?.rating) {
              acc.push(current.trackAnnotation.rating);
            }
            return acc;
          }, []);

          if (artist.tracks.length > 1 && ratings.length > artist.tracks.length * 0.5) {
            const artistRating = Math.round(ratings.reduce((acc, current) => acc + current, 0) / ratings.length);
            if (artistRating > annotation.rating) {
              update.rating = artistRating;
            }
          }

          const lastPlayed = artist.tracks.reduce((acc, current) => {
            return current.trackAnnotation?.play_date > acc ? current.trackAnnotation.play_date : acc;
          }, null);
          if (lastPlayed > annotation.play_date) {
            update.play_date = lastPlayed;
          }

          if (!Object.keys(update).length) {
            return;
          }
          if (!artist.artistAnnotation) {
            await annotation.save();
          }
          await annotation.update(update);
          artistUpdatedCount++;
        })
      )
    );
    progressBar?.stop();
    console.log(`${artistUpdatedCount} artists updated`);
    return artistUpdatedCount;
  };
}

exports.MBNDSynchronizer = MBNDSynchronizer;
