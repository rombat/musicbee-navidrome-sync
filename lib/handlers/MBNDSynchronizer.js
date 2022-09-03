const fs = require('fs');
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

const dbManager = require('./dbManager');
const path = require('path');

class MBNDSynchronizer {
  constructor(options, action) {
    this.REQUIRED_HEADERS = ['<File path>', '<Filename>', '<Folder>', 'Last Played', 'Play Count', 'Rating', 'Love'];
    this.paths = {
      backupFilePath: undefined,
      defaultWorkingDirectory: './',
      defaultDbFileName: 'navidrome.db',
      defaultCsvFileName: 'MusicBee_Export.csv',
      csvFilePath: undefined,
      dbFilePath: undefined
    };
    this.options = options;
    this.limit = pLimit(500);

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
      console.log('Command running with following options:', options);
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
    } catch (e) {}
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

  fullSync = async () => {
    const { options, user, sequelize, limit, paths } = this;

    let musicBeeCollection = await csv2json({
      delimiter: ';',
      colParser: {
        albumRating: 'number',
        playCount: 'number',
        skipCount: 'number',
        rating: item => parseInt(item) || 0,
        dateAdded: item => (dayjs(item, 'DD/MM/YYYY HH:mm').isValid() ? dayjs(item, 'DD/MM/YYYY HH:mm').utc() : null),
        lastPlayed: item => (dayjs(item, 'DD/MM/YYYY HH:mm').isValid() ? dayjs(item, 'DD/MM/YYYY HH:mm').utc() : null),
        dateModified: item => (dayjs(item, 'DD/MM/YYYY HH:mm').isValid() ? dayjs(item, 'DD/MM/YYYY HH:mm').utc() : null),
        love: item => (!!item.trim() ? 1 : 0)
      }
    })
      .preFileLine((fileLineString, lineIdx) => {
        if (lineIdx === 0) {
          this.REQUIRED_HEADERS.map(header => {
            if (!fileLineString.includes(header)) {
              throw new Error(`${header} missing in your CSV headers`);
            }
          });
          return camelCase(fileLineString.replace(/<|>/g, ''));
        }
        return fileLineString;
      })
      .fromFile(paths.csvFilePath);

    musicBeeCollection = musicBeeCollection.filter(
      track => !!track.playCount || !!track.rating || !!track.lastPlayed || !!track.love
    );

    console.log(`${paths.csvFilePath} parsed successfully, ${musicBeeCollection.length} potential tracks to be updated`);

    const { Track, Annotation } = sequelize.models;
    const albumsToUpdate = new Set();
    const artistsToUpdate = new Set();
    const notFoundTracks = [];

    console.log('Processing tracks...');
    const progressBar = options.verbose ? null : new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar?.start(musicBeeCollection.length, 1);
    let tracksAnnotations = await Promise.all(
      musicBeeCollection.map(track =>
        limit(async () => {
          progressBar?.increment();
          const filePathArray = track.filePath.split('\\');
          const filePathEnd = `${filePathArray.length >= 2 ? filePathArray[filePathArray.length - 2] : ''}/${track.folder}/${
            track.filename
          }`;

          const foundTrack = await Track.findOne({
            where: {
              [Op.and]: [
                { title: track.title },
                {
                  path: {
                    [Op.endsWith]: `${filePathEnd}`
                  }
                }
              ]
            },
            include: {
              model: Annotation,
              as: 'trackAnnotation',
              where: {
                item_type: 'media_file',
                user_id: user.id
              },
              required: false
            }
          });
          if (!foundTrack) {
            notFoundTracks.push(track);
            if (options.verbose) {
              console.error(`track not found: ${filePathEnd}`);
            }
            return;
          }
          if (options.verbose) {
            console.log(`processing track: ${filePathEnd}`);
          }

          let annotation = foundTrack?.trackAnnotation;
          if (!annotation) {
            annotation = Annotation.build({
              ann_id: randomUUID(),
              item_type: 'media_file',
              user_id: user.id,
              item_id: foundTrack.id,
              play_count: 0,
              starred: 0
            });
          }

          const update = {};
          if (track.rating > annotation.rating) {
            update.rating = track.rating;
          }
          if (track.love > annotation.starred) {
            update.starred = track.love;
            update.starred_at = track.lastPlayed || null; // this data is not available with MB
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
          albumsToUpdate.add(foundTrack.album_id);
          artistsToUpdate.add(foundTrack.artist_id);

          return annotation;
        })
      )
    );
    progressBar?.stop();
    tracksAnnotations = tracksAnnotations.filter(Boolean);
    console.log(`${tracksAnnotations.length} tracks updated`);
    if (!notFoundTracks.length) {
      console.warn(`${notFoundTracks.length} tracks not found`);
    }

    await this.albumsSync(albumsToUpdate);

    await this.artistsSync(artistsToUpdate);
  };

  /**
   * @param {Set<string>|null} albumsToUpdate
   * @returns {Promise<*[]>}
   */
  albumsSync = async (albumsToUpdate = null) => {
    const { options, user, sequelize, limit } = this;
    const { Track, Annotation, Album } = sequelize.models;
    let albumsAnnotations = [];
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
    const progressBar = options.verbose ? null : new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar?.start(albums.length, 1);
    albumsAnnotations = await Promise.all(
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
              annotation = Annotation.build({
                ann_id: randomUUID(),
                item_type: 'album',
                user_id: user.id,
                item_id: album.id,
                play_count: 0,
                starred: 0
              });
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
            return annotation;
          })
        )
    );
    progressBar?.stop();
    albumsAnnotations = albumsAnnotations.filter(Boolean);
    console.log(`${albumsAnnotations.length} albums updated`);
    return albumsAnnotations;
  };

  /**
   * @param {Set<string>|null} artistsToUpdate
   * @returns {Promise<*[]>}
   */
  artistsSync = async (artistsToUpdate = null) => {
    const { options, user, sequelize, limit } = this;
    const { Track, Annotation, Artist } = sequelize.models;
    let artistsAnnotations = [];
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
    const progressBar = options.verbose ? null : new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar?.start(artists.length, 1);
    artistsAnnotations = await Promise.all(
      artists.map(artist =>
        limit(async () => {
          progressBar?.increment();
          if (options.verbose) {
            console.log(`processing artist ${artist.name}`);
          }

          let annotation = artist?.artistAnnotation;
          if (!annotation) {
            annotation = Annotation.build({
              ann_id: randomUUID(),
              item_type: 'artist',
              user_id: user.id,
              item_id: artist.id,
              play_count: 0,
              starred: 0
            });
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
          return annotation;
        })
      )
    );
    progressBar?.stop();
    artistsAnnotations = artistsAnnotations.filter(Boolean);
    console.log(`${artistsAnnotations.length} artists updated`);
    return artistsAnnotations;
  };
}

exports.MBNDSynchronizer = MBNDSynchronizer;
