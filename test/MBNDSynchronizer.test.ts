import assert from 'node:assert';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { MBNDSynchronizer, type RawSyncOptions } from '../lib/MBNDSynchronizer.js';

// Tests need access to private fields for mocking. Use a narrow internal type
// instead of `as any` to maintain some type documentation.
type SynchronizerInternals = {
  options: RawSyncOptions & { user: string };
  database: unknown;
  user: { id: number | string };
  paths: { csvFilePath: string | undefined; [key: string]: unknown };
  processCsv: (mode: 'count' | 'process', onTrack?: unknown) => Promise<number>;
  albumsSync: () => Promise<number>;
  artistsSync: () => Promise<number>;
};

describe('MBNDSynchronizer', () => {
  let synchronizer: MBNDSynchronizer;
  const mockOptions: RawSyncOptions = {
    user: 'testUser',
    csv: 'test.csv',
    db: 'test.db',
    verbose: false
  };

  beforeEach(() => {
    // Mock fs
    mock.method(fs, 'existsSync', () => true);
    mock.method(fs, 'mkdirSync', () => {});
    mock.method(fs, 'copyFileSync', () => {});
    mock.method(fs, 'rmSync', () => {});

    synchronizer = new MBNDSynchronizer(mockOptions);
  });

  afterEach(() => {
    mock.reset();
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      assert.strictEqual((synchronizer as unknown as SynchronizerInternals).options.user, 'testUser');
    });
  });

  describe('getUser', () => {
    it('should return the specified user', () => {
      // Inject a mock database
      const mockDatabase = {
        prepare: mock.fn(() => ({
          get: mock.fn(() => ({ id: 1, user_name: 'testUser' }))
        }))
      };
      (synchronizer as unknown as SynchronizerInternals).database = mockDatabase;

      const user = synchronizer.getUser();
      assert.strictEqual(user.user_name, 'testUser');
    });
  });

  describe('fullSync', () => {
    it('should perform full sync and update annotations', async () => {
      // In MusicBee CSV, filePath does NOT contain the filename
      const mockTrack = {
        title: 'Song A',
        playCount: 5,
        rating: 4,
        filename: 'song_a.mp3',
        filePath: 'Music/Artist/Album'
      };

      const mockDatabase = {
        query: mock.fn(() => [
          {
            id: 101,
            title: 'Song A',
            path: '/media/Music/Artist/Album/song_a.mp3', // This path overlaps with filePath, so score > 0
            annotation_play_count: 2,
            annotation_rating: 0
          }
        ]),
        upsertAnnotation: mock.fn(),
        executeTransaction: mock.fn(async (cb: () => Promise<void>) => await cb())
      };

      const internals = synchronizer as unknown as SynchronizerInternals;
      internals.database = mockDatabase;
      internals.user = { id: 1 };
      internals.paths.csvFilePath = 'test.csv';

      // Mock processCsv to avoid real file reading
      mock.method(
        synchronizer as unknown as SynchronizerInternals,
        'processCsv',
        async (mode: string, onTrack?: (track: unknown) => void) => {
          if (mode === 'count') {
            return 1;
          }
          if (mode === 'process' && onTrack) {
            onTrack(mockTrack);
          }
          return 1;
        }
      );

      // Mock albumsSync and artistsSync
      mock.method(synchronizer as unknown as SynchronizerInternals, 'albumsSync', () => Promise.resolve(0));
      mock.method(synchronizer as unknown as SynchronizerInternals, 'artistsSync', () => Promise.resolve(0));

      await synchronizer.fullSync();

      assert.strictEqual(mockDatabase.upsertAnnotation.mock.callCount(), 1);
      const upsertArgs = mockDatabase.upsertAnnotation.mock.calls[0].arguments[0] as {
        itemId: number;
        update: { play_count: number; rating: number };
      };
      assert.strictEqual(upsertArgs.itemId, 101);
      assert.strictEqual(upsertArgs.update.play_count, 5);
      assert.strictEqual(upsertArgs.update.rating, 4);
    });

    it('should export not found tracks to a CSV file when exportNotFound is set', async () => {
      const mockTrack = {
        title: 'Song B',
        playCount: 3,
        rating: 0,
        filename: 'song_b.mp3',
        filePath: 'Music/Artist "Quoted"/Album'
      };

      const mockDatabase = {
        query: mock.fn(() => []), // no match -> not found
        upsertAnnotation: mock.fn(),
        executeTransaction: mock.fn(async (cb: () => Promise<void>) => await cb())
      };

      const writeFileSyncMock = mock.method(fs, 'writeFileSync', () => {});

      const internals = synchronizer as unknown as SynchronizerInternals;
      internals.options.exportNotFound = true;
      internals.database = mockDatabase;
      internals.user = { id: 1 };
      internals.paths.csvFilePath = 'test.csv';

      mock.method(
        synchronizer as unknown as SynchronizerInternals,
        'processCsv',
        async (mode: string, onTrack?: (track: unknown) => void) => {
          if (mode === 'process' && onTrack) {
            onTrack(mockTrack);
          }
          return 1;
        }
      );
      mock.method(synchronizer as unknown as SynchronizerInternals, 'albumsSync', () => Promise.resolve(0));
      mock.method(synchronizer as unknown as SynchronizerInternals, 'artistsSync', () => Promise.resolve(0));

      await synchronizer.fullSync();

      assert.strictEqual(mockDatabase.upsertAnnotation.mock.callCount(), 0);
      assert.strictEqual(writeFileSyncMock.mock.callCount(), 1);
      const [exportPath, content] = writeFileSyncMock.mock.calls[0].arguments as [string, string];
      assert.match(exportPath, /^\.\/not_found_tracks_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/);
      assert.strictEqual(content, 'path\n"Music/Artist ""Quoted""/Album"\n');
    });
  });

  describe('albumsSync', () => {
    it('should aggregate track stats and update album annotation', async () => {
      const mockAlbumData = [
        {
          album_id: 201,
          name: 'Album A',
          total_tracks: 10,
          total_tracks_play_count: 50,
          tracks_rated_count: 8,
          tracks_rating_sum: 32, // Avg 4
          tracks_last_played: '2023-01-01T12:00:00Z',
          album_play_count: 10,
          album_rating: 0,
          album_last_played: '2022-01-01T12:00:00Z'
        }
      ];

      const mockDatabase = {
        query: mock.fn(() => mockAlbumData),
        upsertAnnotation: mock.fn(),
        executeTransaction: mock.fn(async (cb: () => Promise<void>) => await cb())
      };

      (synchronizer as unknown as SynchronizerInternals).database = mockDatabase;
      (synchronizer as unknown as SynchronizerInternals).user = { id: 1 };

      await synchronizer.albumsSync();

      assert.strictEqual(mockDatabase.upsertAnnotation.mock.callCount(), 1);
      const upsertArgs = mockDatabase.upsertAnnotation.mock.calls[0].arguments[0] as {
        itemType: string;
        itemId: number;
        update: { play_count: number; rating: number };
      };
      assert.strictEqual(upsertArgs.itemType, 'album');
      assert.strictEqual(upsertArgs.itemId, 201);
      assert.strictEqual(upsertArgs.update.play_count, 50);
      assert.strictEqual(upsertArgs.update.rating, 4);
    });
  });

  describe('artistsSync', () => {
    it('should aggregate track stats and update artist annotation', async () => {
      const mockArtistData = [
        {
          artist_id: 301,
          name: 'Artist A',
          total_tracks: 15,
          total_tracks_play_count: 100,
          tracks_rated_count: 10,
          tracks_rating_sum: 50, // Avg 5
          tracks_last_played: '2023-01-01T12:00:00Z',
          artist_play_count: 20,
          artist_rating: 0,
          artist_last_played: '2022-01-01T12:00:00Z'
        }
      ];

      const mockDatabase = {
        query: mock.fn(() => mockArtistData),
        upsertAnnotation: mock.fn(),
        executeTransaction: mock.fn(async (cb: () => Promise<void>) => await cb()),
        hasMediaFileArtistsTable: mock.fn(() => false)
      };

      (synchronizer as unknown as SynchronizerInternals).database = mockDatabase;
      (synchronizer as unknown as SynchronizerInternals).user = { id: 1 };

      await synchronizer.artistsSync();

      assert.strictEqual(mockDatabase.upsertAnnotation.mock.callCount(), 1);
      const upsertArgs = mockDatabase.upsertAnnotation.mock.calls[0].arguments[0] as {
        itemType: string;
        itemId: number;
        update: { play_count: number; rating: number };
      };
      assert.strictEqual(upsertArgs.itemType, 'artist');
      assert.strictEqual(upsertArgs.itemId, 301);
      assert.strictEqual(upsertArgs.update.play_count, 100);
      assert.strictEqual(upsertArgs.update.rating, 5);
    });
  });
});
