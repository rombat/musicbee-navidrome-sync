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

    console.log('Processing tracks...');

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
                  console.error(`track not found: ${track.filename} in${track.filePath}`);
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
   * Get album statistics with existing annotations in one efficient query
   */
  getAlbumsWithStats = async (user, albumIds = null) => {
    const { sequelize } = this;

    let whereClause = '';
    if (albumIds?.length) {
      whereClause = `AND a.id IN (${albumIds.map(() => '?').join(',')})`;
    }

    const query = `
      SELECT
        a.id AS album_id,
        a.name,
        COUNT(mf.id) AS total_tracks,
        SUM(COALESCE(ta.play_count, 0)) AS total_tracks_play_count,
        SUM(CASE WHEN ta.rating IS NULL OR ta.rating = 0 THEN 0 ELSE 1 END) AS tracks_rated_count,
        SUM(COALESCE(ta.rating, 0)) AS tracks_rating_sum,
        MAX(ta.play_date) AS tracks_last_played,
        MAX(aa.rating) AS album_rating,
        MAX(aa.play_count) AS album_play_count,
        MAX(aa.play_date) AS album_last_played
      FROM album a
      INNER JOIN media_file mf ON mf.album_id = a.id
      LEFT JOIN annotation ta ON (
        ta.item_id = mf.id 
        AND ta.item_type = 'media_file' 
        AND ta.user_id = ?
      )
      LEFT JOIN annotation aa ON (
        aa.item_id = a.id
        AND aa.item_type = 'album'
        AND aa.user_id = ?
      )
      WHERE 1=1 ${whereClause}
      GROUP BY a.id, a.name
      HAVING total_tracks_play_count > 0 OR tracks_rated_count > 0 OR tracks_last_played IS NOT NULL
    `;

    const params = [user.id, user.id];
    if (albumIds?.length) {
      params.push(...albumIds);
    }

    const results = await sequelize.query(query, {
      replacements: params,
      type: sequelize.QueryTypes.SELECT
    });

    return results;
  };

  /**
   * @param {Set<string>|null} albumsToUpdate
   * @returns {Promise<number>}
   */
  albumsSync = async (albumsToUpdate = null) => {
    const { options, user, sequelize, limit } = this;
    const { Annotation } = sequelize.models;

    console.log('Processing albums...');

    const albumsData = await this.getAlbumsWithStats(user, albumsToUpdate ? [...albumsToUpdate] : null);

    if (albumsData.length === 0) {
      console.log('0 albums updated');
      return 0;
    }

    const progressBar = options.verbose
      ? null
      : new cliProgress.SingleBar(
        { etaBuffer: Math.max(100, Math.floor(albumsData.length * 0.1)) },
        cliProgress.Presets.shades_classic
      );
    progressBar?.start(albumsData.length, 0);

    let albumUpdatedCount = 0;

    await Promise.all(
      albumsData.map(albumData =>
        limit(async () => {
          progressBar?.increment();

          const needsCreate = albumData.album_play_count === null && albumData.album_rating === null;

          const update = {};
          const currentPlayCount = albumData.album_play_count || 0;
          const currentRating = albumData.album_rating || 0;
          const currentPlayDate = albumData.album_last_played;

          if (albumData.total_tracks_play_count > currentPlayCount) {
            update.play_count = albumData.total_tracks_play_count;
          }

          if (albumData.tracks_rated_count > albumData.total_tracks * 0.5) {
            const newRating = Math.round(albumData.tracks_rating_sum / albumData.tracks_rated_count);
            if (newRating > currentRating) {
              update.rating = newRating;
            }
          }

          if (albumData.tracks_last_played && albumData.tracks_last_played > currentPlayDate) {
            update.play_date = albumData.tracks_last_played;
          }

          if (!Object.keys(update).length) {
            return;
          }

          if (needsCreate) {
            const record = {
              item_type: 'album',
              user_id: user.id,
              item_id: albumData.album_id,
              play_count: 0,
              starred: 0,
              rating: 0,
              ...update
            };

            if (Annotation.getAttributes().ann_id) {
              record.ann_id = randomUUID();
            }

            await Annotation.create(record);
          } else {
            await Annotation.update(update, {
              where: {
                item_type: 'album',
                user_id: user.id,
                item_id: albumData.album_id
              }
            });
          }

          albumUpdatedCount++;

          if (options.verbose) {
            console.log(`Updated album: ${albumData.name}`);
          }
        })
      )
    );

    progressBar?.stop();
    console.log(`${albumUpdatedCount} albums updated`);
    return albumUpdatedCount;
  };


  /**
   * Get artist statistics with existing annotations - handles both old and new schema
   */
  getArtistsWithStats = async (user, artistIds = null) => {
    const { sequelize } = this;

    let whereClause = '';
    if (artistIds?.length) {
      whereClause = `AND ar.id IN (${artistIds.map(() => '?').join(',')})`;
    }

    const hasMediaFileArtists = await sequelize.getQueryInterface().tableExists('media_file_artists');

    if (this.options.verbose) {
      console.log(`Using ${hasMediaFileArtists ? 'new' : 'old'} artist schema (${hasMediaFileArtists ? 'media_file_artist junction table' : 'direct artist_id'})`);
    }

    const { joinClause, countColumn, annotationJoin } = hasMediaFileArtists
      ? {
        joinClause: `INNER JOIN media_file_artists mfa ON (mfa.artist_id = ar.id AND mfa.role = 'artist')`,
        countColumn: `COUNT(mfa.media_file_id) AS total_tracks`,
        annotationJoin: `LEFT JOIN annotation ta ON (
            ta.item_id = mfa.media_file_id 
            AND ta.item_type = 'media_file' 
            AND ta.user_id = ?
          )`
      }
      : {
        joinClause: `INNER JOIN media_file mf ON mf.artist_id = ar.id`,
        countColumn: `COUNT(mf.id) AS total_tracks`,
        annotationJoin: `LEFT JOIN annotation ta ON (
            ta.item_id = mf.id 
            AND ta.item_type = 'media_file' 
            AND ta.user_id = ?
          )`
      };

    const query = `
      SELECT
        ar.id AS artist_id,
        ar.name,
        ${countColumn},
        SUM(COALESCE(ta.play_count, 0)) AS total_tracks_play_count,
        SUM(CASE WHEN ta.rating IS NULL OR ta.rating = 0 THEN 0 ELSE 1 END) AS tracks_rated_count,
        SUM(COALESCE(ta.rating, 0)) AS tracks_rating_sum,
        MAX(ta.play_date) AS tracks_last_played,
        MAX(aa.rating) AS artist_rating,
        MAX(aa.play_count) AS artist_play_count,
        MAX(aa.play_date) AS artist_last_played
      FROM artist ar
      ${joinClause}
      ${annotationJoin}
      LEFT JOIN annotation aa ON (
        aa.item_id = ar.id
        AND aa.item_type = 'artist'
        AND aa.user_id = ?
      )
      WHERE 1=1 ${whereClause}
      GROUP BY ar.id, ar.name
      HAVING total_tracks_play_count > 0 OR tracks_rated_count > 0 OR tracks_last_played IS NOT NULL
    `;

    const params = [user.id, user.id];
    if (artistIds?.length) {
      params.push(...artistIds);
    }

    const results = await sequelize.query(query, {
      replacements: params,
      type: sequelize.QueryTypes.SELECT
    });

    return results;
  };

  /**
   * @param {Set<string>|null} artistsToUpdate
   * @returns {Promise<number>}
   */
  artistsSync = async (artistsToUpdate = null) => {
    const { options, user, sequelize, limit } = this;
    const { Annotation } = sequelize.models;

    console.log('Processing artists...');

    const artistsData = await this.getArtistsWithStats(user, artistsToUpdate ? [...artistsToUpdate] : null);

    if (artistsData.length === 0) {
      console.log('0 artists updated');
      return 0;
    }

    const progressBar = options.verbose
      ? null
      : new cliProgress.SingleBar(
        { etaBuffer: Math.max(100, Math.floor(artistsData.length * 0.1)) },
        cliProgress.Presets.shades_classic
      );
    progressBar?.start(artistsData.length, 0);

    let artistUpdatedCount = 0;

    await Promise.all(
      artistsData.map(artistData =>
        limit(async () => {
          progressBar?.increment();

          const needsCreate = artistData.artist_play_count === null && artistData.artist_rating === null;

          const update = {};
          const currentPlayCount = artistData.artist_play_count || 0;
          const currentRating = artistData.artist_rating || 0;
          const currentPlayDate = artistData.artist_last_played;

          if (artistData.total_tracks_play_count > currentPlayCount) {
            update.play_count = artistData.total_tracks_play_count;
          }

          if (artistData.total_tracks > 1 && artistData.tracks_rated_count > artistData.total_tracks * 0.5) {
            const newRating = Math.round(artistData.tracks_rating_sum / artistData.tracks_rated_count);
            if (newRating > currentRating) {
              update.rating = newRating;
            }
          }

          if (artistData.tracks_last_played && artistData.tracks_last_played > currentPlayDate) {
            update.play_date = artistData.tracks_last_played;
          }

          if (!Object.keys(update).length) {
            return;
          }

          if (needsCreate) {
            const record = {
              item_type: 'artist',
              user_id: user.id,
              item_id: artistData.artist_id,
              play_count: 0,
              starred: 0,
              rating: 0,
              ...update
            };

            if (Annotation.getAttributes().ann_id) {
              record.ann_id = randomUUID();
            }

            await Annotation.create(record);
          } else {
            await Annotation.update(update, {
              where: {
                item_type: 'artist',
                user_id: user.id,
                item_id: artistData.artist_id
              }
            });
          }

          artistUpdatedCount++;

          if (options.verbose) {
            console.log(`Updated artist: ${artistData.name}`);
          }
        })
      )
    );

    progressBar?.stop();
    console.log(`${artistUpdatedCount} artists updated`);
    return artistUpdatedCount;
  };
}

exports.MBNDSynchronizer = MBNDSynchronizer;
