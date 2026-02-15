import assert from 'node:assert';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import fs from 'node:fs';

import { MBNDSynchronizer } from '../lib/MBNDSynchronizer.js';

describe('MBNDSynchronizer', () => {
  let synchronizer;
  const mockOptions = {
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
      assert.strictEqual(synchronizer.options.user, 'testUser');
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
      synchronizer.database = mockDatabase;

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
        executeTransaction: mock.fn(async cb => await cb())
      };

      synchronizer.database = mockDatabase;
      synchronizer.user = { id: 1 };
      synchronizer.paths.csvFilePath = 'test.csv';

      // Mock processCsv to avoid real file reading
      mock.method(synchronizer, 'processCsv', async (mode, onTrack) => {
        if (mode === 'count') {
          return 1;
        }
        if (mode === 'process') {
          onTrack(mockTrack);
        }
        return 1;
      });

      // Mock albumsSync and artistsSync
      mock.method(synchronizer, 'albumsSync', () => Promise.resolve(0));
      mock.method(synchronizer, 'artistsSync', () => Promise.resolve(0));

      await synchronizer.fullSync();

      assert.strictEqual(mockDatabase.upsertAnnotation.mock.callCount(), 1);
      const upsertArgs = mockDatabase.upsertAnnotation.mock.calls[0].arguments[0];
      assert.strictEqual(upsertArgs.itemId, 101);
      assert.strictEqual(upsertArgs.update.play_count, 5);
      assert.strictEqual(upsertArgs.update.rating, 4);
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
        executeTransaction: mock.fn(async cb => await cb())
      };

      synchronizer.database = mockDatabase;
      synchronizer.user = { id: 1 };

      await synchronizer.albumsSync();

      assert.strictEqual(mockDatabase.upsertAnnotation.mock.callCount(), 1);
      const upsertArgs = mockDatabase.upsertAnnotation.mock.calls[0].arguments[0];
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
        executeTransaction: mock.fn(async cb => await cb()),
        hasMediaFileArtistsTable: mock.fn(() => false)
      };

      synchronizer.database = mockDatabase;
      synchronizer.user = { id: 1 };

      await synchronizer.artistsSync();

      assert.strictEqual(mockDatabase.upsertAnnotation.mock.callCount(), 1);
      const upsertArgs = mockDatabase.upsertAnnotation.mock.calls[0].arguments[0];
      assert.strictEqual(upsertArgs.itemType, 'artist');
      assert.strictEqual(upsertArgs.itemId, 301);
      assert.strictEqual(upsertArgs.update.play_count, 100);
      assert.strictEqual(upsertArgs.update.rating, 5);
    });
  });
});
