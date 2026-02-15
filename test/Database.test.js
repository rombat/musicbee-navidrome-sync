import assert from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);

import * as dbManager from '../lib/Database.js';

describe('Database', () => {
  let database;

  afterEach(() => {
    if (database) {
      try {
        database.close();
      } catch (_e) {
        // Ignore close errors during cleanup
      }
      database = null;
    }
  });

  describe('constructor and basic connection', () => {
    it('should create database connection successfully', async () => {
      database = await dbManager.init(':memory:');
      assert(database);
      assert.strictEqual(database.constructor.name, 'Database');
    });

    it('should verify connection with test query', async () => {
      database = await dbManager.init(':memory:');
      const result = database.prepare('SELECT 1 as test').get();
      assert.strictEqual(result.test, 1);
    });

    it('should handle invalid database path gracefully', async () => {
      try {
        const invalidPath = '/nonexistent/directory/test.db';
        await dbManager.init(invalidPath);
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert(error);
      }
    });
  });

  describe('query and prepare methods', () => {
    beforeEach(async () => {
      database = await dbManager.init(':memory:');

      database
        .prepare(
          `
        CREATE TABLE test_table (
          id INTEGER PRIMARY KEY,
          name TEXT,
          value INTEGER
        )
      `
        )
        .run();

      database.prepare('INSERT INTO test_table (name, value) VALUES (?, ?)').run('test1', 100);
      database.prepare('INSERT INTO test_table (name, value) VALUES (?, ?)').run('test2', 200);
    });

    it('should execute query with parameters', () => {
      const results = database.query('SELECT * FROM test_table WHERE value > ?', [150]);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'test2');
      assert.strictEqual(results[0].value, 200);
    });

    it('should execute query without parameters', () => {
      const results = database.query('SELECT COUNT(*) as count FROM test_table');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].count, 2);
    });

    it('should prepare and execute statements', () => {
      const stmt = database.prepare('SELECT * FROM test_table WHERE name = ?');
      const result = stmt.get('test1');
      assert.strictEqual(result.name, 'test1');
      assert.strictEqual(result.value, 100);
    });

    it('should handle empty results', () => {
      const results = database.query('SELECT * FROM test_table WHERE value > ?', [300]);
      assert.strictEqual(results.length, 0);
    });
  });

  describe('schema detection methods', () => {
    beforeEach(async () => {
      database = await dbManager.init(':memory:');
    });

    describe('tableExists', () => {
      it('should return true for existing table', () => {
        database.prepare('CREATE TABLE existing_table (id INTEGER)').run();
        const exists = database.tableExists('existing_table');
        assert.strictEqual(exists, true);
      });

      it('should return false for non-existing table', () => {
        const exists = database.tableExists('nonexistent_table');
        assert.strictEqual(exists, false);
      });

      it('should handle case sensitivity', () => {
        database.prepare('CREATE TABLE CamelCase (id INTEGER)').run();
        const exists = database.tableExists('CamelCase');
        assert.strictEqual(exists, true);
      });
    });

    describe('getTableSchema', () => {
      it('should return correct schema for simple table', () => {
        database
          .prepare(
            `
          CREATE TABLE simple_table (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            optional_field TEXT
          )
        `
          )
          .run();

        const schema = database.getTableSchema('simple_table');
        assert('id' in schema);
        assert('name' in schema);
        assert('optional_field' in schema);

        assert.strictEqual(schema.id.primaryKey, true);
        assert.strictEqual(schema.name.notNull, true);
        assert.strictEqual(schema.optional_field.notNull, false);
      });

      it('should return correct types', () => {
        database
          .prepare(
            `
          CREATE TABLE typed_table (
            int_field INTEGER,
            text_field TEXT,
            real_field REAL
          )
        `
          )
          .run();

        const schema = database.getTableSchema('typed_table');
        assert.strictEqual(schema.int_field.type, 'INTEGER');
        assert.strictEqual(schema.text_field.type, 'TEXT');
        assert.strictEqual(schema.real_field.type, 'REAL');
      });

      it('should handle default values', () => {
        database
          .prepare(
            `
          CREATE TABLE default_table (
            id INTEGER PRIMARY KEY,
            status TEXT DEFAULT 'active',
            count INTEGER DEFAULT 0
          )
        `
          )
          .run();

        const schema = database.getTableSchema('default_table');
        assert.strictEqual(schema.status.defaultValue, "'active'");
        assert.strictEqual(schema.count.defaultValue, '0');
      });
    });

    describe('hasLegacyAnnotationSchema', () => {
      it('should return false when annotation table does not exist', () => {
        const hasLegacy = database.hasLegacyAnnotationSchema();
        assert.strictEqual(hasLegacy, false);
      });

      it('should return true when annotation table has ann_id column', () => {
        database
          .prepare(
            `
          CREATE TABLE annotation (
            ann_id TEXT PRIMARY KEY,
            user_id TEXT,
            item_id TEXT,
            item_type TEXT
          )
        `
          )
          .run();

        const hasLegacy = database.hasLegacyAnnotationSchema();
        assert.strictEqual(hasLegacy, true);
      });

      it('should return false when annotation table lacks ann_id column', () => {
        database
          .prepare(
            `
          CREATE TABLE annotation (
            user_id TEXT,
            item_id TEXT,
            item_type TEXT,
            PRIMARY KEY (user_id, item_id, item_type)
          )
        `
          )
          .run();

        const hasLegacy = database.hasLegacyAnnotationSchema();
        assert.strictEqual(hasLegacy, false);
      });
    });

    describe('hasMediaFileArtistsTable', () => {
      it('should return false when table does not exist', () => {
        const hasTable = database.hasMediaFileArtistsTable();
        assert.strictEqual(hasTable, false);
      });

      it('should return true when media_file_artists table exists', () => {
        database
          .prepare(
            `
          CREATE TABLE media_file_artists (
            media_file_id TEXT,
            artist_id TEXT,
            role TEXT
          )
        `
          )
          .run();

        const hasTable = database.hasMediaFileArtistsTable();
        assert.strictEqual(hasTable, true);
      });
    });
  });

  describe('upsertAnnotation method', () => {
    beforeEach(async () => {
      database = await dbManager.init(':memory:');
    });

    describe('with modern annotation schema (no ann_id)', () => {
      beforeEach(() => {
        database
          .prepare(
            `
          CREATE TABLE annotation (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            item_type TEXT NOT NULL,
            play_count INTEGER DEFAULT 0,
            play_date TEXT,
            rating INTEGER DEFAULT 0,
            starred INTEGER DEFAULT 0,
            starred_at TEXT,
            PRIMARY KEY (user_id, item_id, item_type)
          )
        `
          )
          .run();
      });

      it('should create new annotation when needsCreate is true', async () => {
        const update = {
          play_count: 5,
          rating: 4,
          play_date: dayjs.utc('2024-01-15 10:30:00')
        };

        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: true
        });

        const result = database.prepare('SELECT * FROM annotation WHERE user_id = ? AND item_id = ?').get('user1', 'track1');
        assert(result);
        assert.strictEqual(result.play_count, 5);
        assert.strictEqual(result.rating, 4);
        assert.strictEqual(result.play_date, '2024-01-15 10:30:00');
        assert.strictEqual(result.item_type, 'media_file');
      });

      it('should update existing annotation when needsCreate is false', async () => {
        // Create initial annotation
        database
          .prepare(
            `
          INSERT INTO annotation (user_id, item_id, item_type, play_count, rating) 
          VALUES (?, ?, ?, ?, ?)
        `
          )
          .run('user1', 'track1', 'media_file', 3, 2);

        const update = {
          play_count: 8,
          rating: 5
        };

        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: false
        });

        const result = database.prepare('SELECT * FROM annotation WHERE user_id = ? AND item_id = ?').get('user1', 'track1');
        assert.strictEqual(result.play_count, 8);
        assert.strictEqual(result.rating, 5);
      });

      it('should handle date formatting correctly', async () => {
        const testDate = dayjs.utc('2024-01-15 10:30:00');
        const update = {
          play_date: testDate,
          starred_at: testDate
        };

        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: true
        });

        const result = database.prepare('SELECT * FROM annotation WHERE user_id = ? AND item_id = ?').get('user1', 'track1');
        assert.strictEqual(result.play_date, '2024-01-15 10:30:00');
        assert.strictEqual(result.starred_at, '2024-01-15 10:30:00');
      });

      it('should handle MusicBee CSV dayjs objects correctly', async () => {
        // Simulate exactly how CSV dates are parsed
        const musicbeeDate = '28/04/2009 07:38';
        const format = 'DD/MM/YYYY HH:mm';
        const csvParsedDate = dayjs(musicbeeDate, format).utc();

        const update = {
          play_date: csvParsedDate, // This is a dayjs UTC object
          rating: 5
        };

        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: true
        });

        const result = database.prepare('SELECT * FROM annotation WHERE user_id = ? AND item_id = ?').get('user1', 'track1');
        // Should store the UTC time (which would be 05:38 if local timezone was UTC+2)
        assert.match(result.play_date, /2009-04-28 \d{2}:38:00/); // Time depends on local timezone
        assert.strictEqual(result.rating, 5);
      });

      it('should handle different item types', async () => {
        const update = { play_count: 10, rating: 5 };

        // Test album annotation
        await database.upsertAnnotation({
          itemType: 'album',
          userId: 'user1',
          itemId: 'album1',
          update,
          needsCreate: true
        });

        // Test artist annotation
        await database.upsertAnnotation({
          itemType: 'artist',
          userId: 'user1',
          itemId: 'artist1',
          update,
          needsCreate: true
        });

        const albumResult = database.prepare('SELECT * FROM annotation WHERE item_type = ?').get('album');
        const artistResult = database.prepare('SELECT * FROM annotation WHERE item_type = ?').get('artist');

        assert.strictEqual(albumResult.item_id, 'album1');
        assert.strictEqual(artistResult.item_id, 'artist1');
      });
    });

    describe('with legacy annotation schema (with ann_id)', () => {
      beforeEach(() => {
        database
          .prepare(
            `
          CREATE TABLE annotation (
            ann_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            item_type TEXT NOT NULL,
            play_count INTEGER DEFAULT 0,
            play_date TEXT,
            rating INTEGER DEFAULT 0,
            starred INTEGER DEFAULT 0,
            starred_at TEXT
          )
        `
          )
          .run();
      });

      it('should include ann_id when creating new annotation in legacy schema', async () => {
        const update = { play_count: 5, rating: 4 };

        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: true
        });

        const result = database.prepare('SELECT * FROM annotation WHERE user_id = ? AND item_id = ?').get('user1', 'track1');
        assert(result);
        assert(result.ann_id);
        assert.strictEqual(typeof result.ann_id, 'string');
        assert(result.ann_id.length > 0);
      });

      it('should update existing annotation in legacy schema', async () => {
        database
          .prepare(
            `
          INSERT INTO annotation (ann_id, user_id, item_id, item_type, play_count, rating) 
          VALUES (?, ?, ?, ?, ?, ?)
        `
          )
          .run('existing-id', 'user1', 'track1', 'media_file', 3, 2);

        const update = { play_count: 8, rating: 5 };

        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: false
        });

        const result = database.prepare('SELECT * FROM annotation WHERE ann_id = ?').get('existing-id');
        assert.strictEqual(result.play_count, 8);
        assert.strictEqual(result.rating, 5);
        assert.strictEqual(result.ann_id, 'existing-id');
      });
    });

    describe('error scenarios', () => {
      beforeEach(() => {
        database
          .prepare(
            `
          CREATE TABLE annotation (
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            item_type TEXT NOT NULL,
            play_count INTEGER DEFAULT 0,
            play_date TEXT,
            rating INTEGER DEFAULT 0,
            starred INTEGER DEFAULT 0,
            starred_at TEXT,
            PRIMARY KEY (user_id, item_id, item_type)
          )
        `
          )
          .run();
      });

      it('should handle duplicate key error gracefully during create', async () => {
        const update = { play_count: 5 };

        // First insert should succeed
        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: true
        });

        // Second insert with same key should throw error
        try {
          await database.upsertAnnotation({
            itemType: 'media_file',
            userId: 'user1',
            itemId: 'track1',
            update,
            needsCreate: true
          });
          assert.fail('Should have thrown duplicate key error');
        } catch (error) {
          assert(error.message.includes('UNIQUE constraint failed'));
        }
      });

      it('should handle update of non-existent record', async () => {
        const update = { play_count: 5 };

        // Update non-existent record should not throw but affect 0 rows
        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'nonexistent',
          update,
          needsCreate: false
        });

        // Verify no record was created
        const result = database.prepare('SELECT * FROM annotation WHERE item_id = ?').get('nonexistent');
        assert.strictEqual(result, undefined);
      });
    });
  });

  describe('executeTransaction', () => {
    beforeEach(async () => {
      database = await dbManager.init(':memory:');
      database.prepare('CREATE TABLE trans_test (id INTEGER PRIMARY KEY, val TEXT)').run();
    });

    it('should commit multiple operations on success', async () => {
      await database.executeTransaction(async () => {
        database.prepare('INSERT INTO trans_test (val) VALUES (?)').run('a');
        database.prepare('INSERT INTO trans_test (val) VALUES (?)').run('b');
      });

      const results = database.query('SELECT * FROM trans_test');
      assert.strictEqual(results.length, 2);
    });

    it('should rollback operations on failure', async () => {
      try {
        await database.executeTransaction(async () => {
          database.prepare('INSERT INTO trans_test (val) VALUES (?)').run('c');
          throw new Error('Transaction failure');
        });
      } catch (error) {
        assert.strictEqual(error.message, 'Transaction failure');
      }

      const results = database.query('SELECT * FROM trans_test');
      assert.strictEqual(results.length, 0);
    });
  });

  describe('cleanup and resource management', () => {
    it('should close database connection properly', async () => {
      database = await dbManager.init(':memory:');

      const result = database.prepare('SELECT 1 as test').get();
      assert.strictEqual(result.test, 1);

      database.close();

      try {
        database.prepare('SELECT 1 as test').get();
        assert.fail('Should have thrown error on closed database');
      } catch (error) {
        assert(error.message.includes('database is not open'));
      }
    });

    it('should handle multiple close calls gracefully', async () => {
      database = await dbManager.init(':memory:');

      database.close();

      // Second close should not throw error (but might internally)
      // This is implementation dependent, so we just verify it doesn't crash the process
      try {
        database.close();
      } catch (error) {
        // It's acceptable if the second close throws an error
        assert(error.message.includes('database is not open'));
      }
    });
  });
});
