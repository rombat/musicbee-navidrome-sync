import fs from 'node:fs';
import path from 'node:path';
import camelCase from 'camelcase';
import cliProgress from 'cli-progress';
import csv2json from 'csvtojson';
import dayjs, { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);

import packageJson from '../package.json' with { type: 'json' };
import type { AnnotationUpdate, Database } from './Database.js';
import * as dbManager from './Database.js';
import { findBestMatch, isDateAfter } from './helpers.js';

export type RawSyncOptions = {
  first?: boolean;
  forceRatings?: boolean;
  showNotFound?: boolean;
  exportNotFound?: boolean;
  verbose?: boolean;
  csv?: string;
  db?: string;
  user?: string;
  datetimeFormat?: string;
};

type SyncOptions = {
  first: boolean;
  forceRatings: boolean;
  showNotFound: boolean;
  exportNotFound: boolean;
  verbose: boolean;
  csv?: string;
  db?: string;
  user?: string;
  datetimeFormat?: string;
};

type SyncPaths = {
  backupFilePath: string | undefined;
  defaultWorkingDirectory: string;
  defaultDbFileName: string;
  defaultCsvFileName: string;
  csvFilePath: string | undefined;
  dbFilePath: string | undefined;
};

type CsvTrack = {
  filePath: string;
  filename: string;
  folder: string;
  title: string;
  lastPlayed: Dayjs | null;
  playCount: number;
  rating: number;
  love: number;
  skipCount: number;
  [key: string]: unknown;
};

type NavidromeUser = {
  id: string;
  user_name: string;
};

type FoundTrackRow = {
  id: string;
  path: string;
  title: string;
  album: string;
  album_id: string;
  artist_id: string;
  album_artist: string;
  album_artist_id: string;
  annotation_play_count: number | null;
  annotation_play_date: string | null;
  annotation_rating: number | null;
  annotation_starred: number | null;
  annotation_starred_at: string | null;
};

type AlbumWithStatsRow = {
  album_id: string;
  name: string;
  total_tracks: number;
  total_tracks_play_count: number;
  tracks_rated_count: number;
  tracks_rating_sum: number;
  tracks_last_played: string | null;
  album_rating: number | null;
  album_play_count: number | null;
  album_last_played: string | null;
};

type ArtistWithStatsRow = {
  artist_id: string;
  name: string;
  total_tracks: number;
  total_tracks_play_count: number;
  tracks_rated_count: number;
  tracks_rating_sum: number;
  tracks_last_played: string | null;
  artist_rating: number | null;
  artist_play_count: number | null;
  artist_last_played: string | null;
};

class MBNDSynchronizer {
  private readonly REQUIRED_HEADERS: readonly string[];
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed via destructuring (const { paths } = this)
  private paths: SyncPaths;
  private options: SyncOptions;
  private start: Dayjs;
  private database!: Database;
  private user!: NavidromeUser;

  constructor(options: RawSyncOptions) {
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
    this.options = {
      ...options,
      first: !!options.first,
      forceRatings: !!options.forceRatings,
      showNotFound: !!options.showNotFound,
      exportNotFound: !!options.exportNotFound,
      verbose: !!options.verbose
    };

    process.on('SIGINT', () => this.restoreDbFile());
    process.on('SIGTERM', () => this.restoreDbFile());

    this.start = dayjs();
  }

  /**
   * check/set files paths, backup DB file, connect to it and get navidrome user
   */
  initiate(action: string): void {
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

    this.database = dbManager.init(paths.dbFilePath);
    this.user = this.getUser();
  }

  getUser(): NavidromeUser {
    const { database, options } = this;

    const user = (
      options.user
        ? database.prepare('SELECT id, user_name FROM user WHERE user_name = ?').get(options.user)
        : database.prepare('SELECT id, user_name FROM user LIMIT 1').get()
    ) as NavidromeUser | undefined;

    if (!user) {
      throw new Error(`user ${options.user ?? ''} not found`);
    }
    console.log(`Using user: ${user.user_name}`);
    return user;
  }

  backupDbFile(): void {
    const { paths } = this;
    if (!fs.existsSync('./backups')) {
      fs.mkdirSync('./backups');
    }
    paths.backupFilePath = `./backups/navidrome_${this.start.format('YYYY-MM-DD_HH-mm-ss')}_backup.db`;
    if (!paths.dbFilePath) {
      throw new Error('DB file path not set');
    }
    fs.copyFileSync(paths.dbFilePath, paths.backupFilePath);
    console.log(`DB has been backed up to ${paths.backupFilePath}`);
  }

  restoreDbFile(): void {
    const { paths } = this;
    if (!paths.backupFilePath || !paths.dbFilePath) {
      throw new Error('Backup or DB file path not set');
    }
    fs.copyFileSync(paths.backupFilePath, paths.dbFilePath);
    try {
      this.database.close();
    } catch (_e) {}
  }

  async run(action: string): Promise<void> {
    this.initiate(action);

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

      this.database.close();
      console.log(`${action} completed successfully in ${dayjs().diff(this.start, 'second')}s`);
    } catch (e) {
      this.globalErrorHander(e);
    }
  }

  globalErrorHander(e: unknown): never {
    console.error('An error as occured, restoring DB file...');
    this.restoreDbFile();
    throw e;
  }

  /**
   * Unified CSV processing function that can either count or process tracks
   */
  async processCsv(mode: 'count' | 'process', onTrack: ((track: CsvTrack) => void) | null = null): Promise<number> {
    const { options: syncOptions, paths } = this;
    let headerProcessed = false;
    let processedCount = 0;

    const colParser: Record<string, string | ((item: string) => unknown)> = {
      playCount: 'number',
      rating: (item: string) => {
        let rating = Number.parseInt(item, 10);
        if (!rating) {
          return 0;
        }
        if (rating > 5 && rating <= 100) {
          rating = Math.round(rating / 20);
        }
        return rating;
      },
      lastPlayed: (item: string) =>
        dayjs(item, syncOptions.datetimeFormat).isValid() ? dayjs(item, syncOptions.datetimeFormat).utc() : null,
      love: (item: string) => (item?.trim() ? 1 : 0)
    };

    if (mode === 'process') {
      if (!onTrack) {
        throw new Error('onTrack is required for processing mode');
      }

      colParser.albumRating = 'number';
      colParser.playCount = 'number';
      colParser.skipCount = 'number';
      colParser.dateAdded = (item: string) =>
        dayjs(item, syncOptions.datetimeFormat).isValid() ? dayjs(item, syncOptions.datetimeFormat).utc() : null;
      colParser.dateModified = (item: string) =>
        dayjs(item, syncOptions.datetimeFormat).isValid() ? dayjs(item, syncOptions.datetimeFormat).utc() : null;
    }

    await csv2json({
      delimiter: 'auto',
      colParser
    })
      .preFileLine((fileLineString: string, lineIdx: number) => {
        if (lineIdx === 0 && !headerProcessed) {
          this.REQUIRED_HEADERS.forEach(header => {
            if (!camelCase(fileLineString).includes(camelCase(header))) {
              throw new Error(`${header} missing in your CSV headers`);
            }
          });
          headerProcessed = true;
          return camelCase(fileLineString.replace(/<|>/g, ''));
        }
        return fileLineString;
      })
      .subscribe((track: CsvTrack) => {
        const trackEligible = !!track.playCount || !!track.rating || !!track.lastPlayed || !!track.love;
        if (!trackEligible) {
          return;
        }

        if (mode === 'count' || !onTrack) {
          processedCount++;
          return;
        }

        onTrack(track);
        processedCount++;
      })
      .fromFile(paths.csvFilePath as string);

    return processedCount;
  }

  async fullSync(): Promise<void> {
    const { options, user, database, paths } = this;

    let trackUpdatedCount = 0;
    let notFoundTracksCount = 0;
    const notFoundTracks: string[] = [];

    const totalEligibleTracks = await this.processCsv('count');
    console.log(`${paths.csvFilePath} parsed successfully, ${totalEligibleTracks} potential tracks to be updated`);

    console.log('Processing tracks...');

    let progressBar: cliProgress.SingleBar | null = null;
    if (!options.verbose) {
      progressBar = new cliProgress.SingleBar(
        { etaBuffer: Math.max(100, Math.floor(totalEligibleTracks * 0.1)) },
        cliProgress.Presets.shades_classic
      );
      progressBar.start(totalEligibleTracks, 0);
    }

    await this.database.executeTransaction(async () => {
      await this.processCsv('process', (track: CsvTrack) => {
        progressBar?.increment();

        const foundTracks = database.query<FoundTrackRow>(
          `
          SELECT
            mf.id,
            mf.path,
            mf.title,
            mf.album,
            mf.album_id,
            mf.artist_id,
            mf.album_artist,
            mf.album_artist_id,
            a.play_count as annotation_play_count,
            a.play_date as annotation_play_date,
            a.rating as annotation_rating,
            a.starred as annotation_starred,
            a.starred_at as annotation_starred_at
          FROM media_file mf
          LEFT JOIN annotation a ON (
            a.item_id = mf.id
            AND a.item_type = 'media_file'
            AND a.user_id = ?
          )
          WHERE mf.title = ?
          AND mf.path LIKE ?
        `,
          [user.id, track.title, `%${track.filename}`]
        );
        const foundTrack = findBestMatch(track, foundTracks);

        if (!foundTrack) {
          notFoundTracksCount++;
          if (options.exportNotFound) {
            notFoundTracks.push(track.filePath);
          }
          if (options.verbose || options.showNotFound) {
            console.error(`track not found. path: ${track.filePath} | filename: ${track.filename}`);
          }
          return;
        }

        if (options.verbose) {
          console.log(`processing track: ${track.filePath}`);
        }

        const hasExistingAnnotation = foundTrack.annotation_play_count !== null || foundTrack.annotation_rating !== null;

        const annotation = {
          play_count: foundTrack.annotation_play_count || 0,
          play_date: foundTrack.annotation_play_date,
          rating: foundTrack.annotation_rating || 0,
          starred: foundTrack.annotation_starred || 0,
          starred_at: foundTrack.annotation_starred_at
        };

        const update: AnnotationUpdate = {};
        if (track.rating !== annotation.rating && (options.forceRatings || track.rating > annotation.rating)) {
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

        if (isDateAfter(track.lastPlayed, annotation.play_date)) {
          update.play_date = track.lastPlayed;
          if (!annotation.play_count && !update.play_count && !track.skipCount && !track.playCount) {
            update.play_count = 1;
          }
        }

        if (!Object.keys(update).length) {
          return;
        }

        database.upsertAnnotation({
          itemType: 'media_file',
          userId: user.id,
          itemId: foundTrack.id,
          update,
          needsCreate: !hasExistingAnnotation
        });
        trackUpdatedCount++;
      });
    });

    progressBar?.stop();
    console.log(`${trackUpdatedCount} tracks updated`);

    if (notFoundTracksCount > 0) {
      console.warn(`${notFoundTracksCount} tracks not found`);
      if (options.exportNotFound) {
        const exportPath = `./not_found_tracks_${this.start.format('YYYY-MM-DD_HH-mm-ss')}.csv`;
        const rows = notFoundTracks.map(trackPath => `"${trackPath.replace(/"/g, '""')}"`);
        fs.writeFileSync(exportPath, `path\n${rows.join('\n')}\n`);
        console.log(`Not found tracks exported to ${exportPath}`);
      }
    }

    await this.albumsSync();

    await this.artistsSync();
  }

  getAlbumsWithStats(user: NavidromeUser, albumIds: string[] | null = null): AlbumWithStatsRow[] {
    const { database } = this;

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

    const params: (string | number)[] = [user.id, user.id];
    if (albumIds?.length) {
      params.push(...albumIds);
    }

    return database.query<AlbumWithStatsRow>(query, params);
  }

  async albumsSync(albumsToUpdate: Set<string> | null = null): Promise<number> {
    const { options, user, database } = this;

    console.log('Processing albums...');

    const albumsData = this.getAlbumsWithStats(user, albumsToUpdate ? [...albumsToUpdate] : null);

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

    await this.database.executeTransaction(() => {
      for (const albumData of albumsData) {
        progressBar?.increment();

        const needsCreate = albumData.album_play_count === null && albumData.album_rating === null;

        const update: AnnotationUpdate = {};
        const currentPlayCount = albumData.album_play_count || 0;
        const currentRating = albumData.album_rating || 0;
        const currentPlayDate = albumData.album_last_played;

        if (albumData.total_tracks_play_count > currentPlayCount) {
          update.play_count = albumData.total_tracks_play_count;
        }

        if (albumData.tracks_rated_count > albumData.total_tracks * 0.5) {
          const newRating = Math.round(albumData.tracks_rating_sum / albumData.tracks_rated_count);
          if (newRating !== currentRating && (options.forceRatings || newRating > currentRating)) {
            update.rating = newRating;
          }
        }

        if (isDateAfter(albumData.tracks_last_played, currentPlayDate)) {
          update.play_date = albumData.tracks_last_played;
        }

        if (!Object.keys(update).length) {
          continue;
        }

        database.upsertAnnotation({
          itemType: 'album',
          userId: user.id,
          itemId: albumData.album_id,
          update,
          needsCreate
        });

        albumUpdatedCount++;

        if (options.verbose) {
          console.log(`Updated album: ${albumData.name}`);
        }
      }
    });

    progressBar?.stop();
    console.log(`${albumUpdatedCount} albums updated`);
    return albumUpdatedCount;
  }

  getArtistsWithStats(user: NavidromeUser, artistIds: string[] | null = null): ArtistWithStatsRow[] {
    const { database } = this;

    let whereClause = '';
    if (artistIds?.length) {
      whereClause = `AND ar.id IN (${artistIds.map(() => '?').join(',')})`;
    }

    const hasMediaFileArtists = database.hasMediaFileArtistsTable();

    if (this.options.verbose) {
      console.log(
        `Using ${hasMediaFileArtists ? 'new' : 'old'} artist schema (${
          hasMediaFileArtists ? 'media_file_artist junction table' : 'direct artist_id'
        })`
      );
    }

    const { joinClause, countColumn, annotationJoin } = hasMediaFileArtists
      ? {
          joinClause: `INNER JOIN media_file_artists mfa ON (mfa.artist_id = ar.id AND mfa.role = 'artist')`,
          countColumn: 'COUNT(mfa.media_file_id) AS total_tracks',
          annotationJoin: `LEFT JOIN annotation ta ON (
            ta.item_id = mfa.media_file_id
            AND ta.item_type = 'media_file'
            AND ta.user_id = ?
          )`
        }
      : {
          joinClause: 'INNER JOIN media_file mf ON mf.artist_id = ar.id',
          countColumn: 'COUNT(mf.id) AS total_tracks',
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

    const params: (string | number)[] = [user.id, user.id];
    if (artistIds?.length) {
      params.push(...artistIds);
    }

    return database.query<ArtistWithStatsRow>(query, params);
  }

  async artistsSync(artistsToUpdate: Set<string> | null = null): Promise<number> {
    const { options, user, database } = this;

    console.log('Processing artists...');

    const artistsData = this.getArtistsWithStats(user, artistsToUpdate ? [...artistsToUpdate] : null);

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

    await this.database.executeTransaction(() => {
      for (const artistData of artistsData) {
        progressBar?.increment();

        const needsCreate = artistData.artist_play_count === null && artistData.artist_rating === null;

        const update: AnnotationUpdate = {};
        const currentPlayCount = artistData.artist_play_count || 0;
        const currentRating = artistData.artist_rating || 0;
        const currentPlayDate = artistData.artist_last_played;

        if (artistData.total_tracks_play_count > currentPlayCount) {
          update.play_count = artistData.total_tracks_play_count;
        }

        if (artistData.total_tracks > 1 && artistData.tracks_rated_count > artistData.total_tracks * 0.5) {
          const newRating = Math.round(artistData.tracks_rating_sum / artistData.tracks_rated_count);
          if (newRating !== currentRating && (options.forceRatings || newRating > currentRating)) {
            update.rating = newRating;
          }
        }

        if (isDateAfter(artistData.tracks_last_played, currentPlayDate)) {
          update.play_date = artistData.tracks_last_played;
        }

        if (!Object.keys(update).length) {
          continue;
        }

        database.upsertAnnotation({
          itemType: 'artist',
          userId: user.id,
          itemId: artistData.artist_id,
          update,
          needsCreate
        });

        artistUpdatedCount++;

        if (options.verbose) {
          console.log(`Updated artist: ${artistData.name}`);
        }
      }
    });

    progressBar?.stop();
    console.log(`${artistUpdatedCount} artists updated`);
    return artistUpdatedCount;
  }
}

export { MBNDSynchronizer };
