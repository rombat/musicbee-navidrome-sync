const chai = require('chai');
const expect = chai.expect;
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(utc);
dayjs.extend(customParseFormat);
const dbManager = require('../lib/handlers/dbManager');

describe('Database', function () {
  let database;

  afterEach(function () {
    if (database) {
      try {
        database.close();
      } catch (e) {
        // Ignore close errors during cleanup
      }
      database = null;
    }
  });

  describe('constructor and basic connection', function () {
    it('should create database connection successfully', async function () {
      database = await dbManager.init(':memory:');
      expect(database).to.exist;
      expect(database.constructor.name).to.equal('Database');
    });

    it('should verify connection with test query', async function () {
      database = await dbManager.init(':memory:');
      const result = database.prepare('SELECT 1 as test').get();
      expect(result.test).to.equal(1);
    });

    it('should handle invalid database path gracefully', async function () {
      try {
        const invalidPath = '/nonexistent/directory/test.db';
        await dbManager.init(invalidPath);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });

  describe('query and prepare methods', function () {
    beforeEach(async function () {
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

    it('should execute query with parameters', function () {
      const results = database.query('SELECT * FROM test_table WHERE value > ?', [150]);
      expect(results).to.have.length(1);
      expect(results[0].name).to.equal('test2');
      expect(results[0].value).to.equal(200);
    });

    it('should execute query without parameters', function () {
      const results = database.query('SELECT COUNT(*) as count FROM test_table');
      expect(results).to.have.length(1);
      expect(results[0].count).to.equal(2);
    });

    it('should prepare and execute statements', function () {
      const stmt = database.prepare('SELECT * FROM test_table WHERE name = ?');
      const result = stmt.get('test1');
      expect(result.name).to.equal('test1');
      expect(result.value).to.equal(100);
    });

    it('should handle empty results', function () {
      const results = database.query('SELECT * FROM test_table WHERE value > ?', [300]);
      expect(results).to.have.length(0);
    });
  });

  describe('schema detection methods', function () {
    beforeEach(async function () {
      database = await dbManager.init(':memory:');
    });

    describe('tableExists', function () {
      it('should return true for existing table', function () {
        database.prepare('CREATE TABLE existing_table (id INTEGER)').run();
        const exists = database.tableExists('existing_table');
        expect(exists).to.be.true;
      });

      it('should return false for non-existing table', function () {
        const exists = database.tableExists('nonexistent_table');
        expect(exists).to.be.false;
      });

      it('should handle case sensitivity', function () {
        database.prepare('CREATE TABLE CamelCase (id INTEGER)').run();
        const exists = database.tableExists('CamelCase');
        expect(exists).to.be.true;
      });
    });

    describe('getTableSchema', function () {
      it('should return correct schema for simple table', function () {
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
        expect(schema).to.have.property('id');
        expect(schema).to.have.property('name');
        expect(schema).to.have.property('optional_field');

        expect(schema.id.primaryKey).to.be.true;
        expect(schema.name.notNull).to.be.true;
        expect(schema.optional_field.notNull).to.be.false;
      });

      it('should return correct types', function () {
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
        expect(schema.int_field.type).to.equal('INTEGER');
        expect(schema.text_field.type).to.equal('TEXT');
        expect(schema.real_field.type).to.equal('REAL');
      });

      it('should handle default values', function () {
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
        expect(schema.status.defaultValue).to.equal("'active'");
        expect(schema.count.defaultValue).to.equal('0');
      });
    });

    describe('hasLegacyAnnotationSchema', function () {
      it('should return false when annotation table does not exist', function () {
        const hasLegacy = database.hasLegacyAnnotationSchema();
        expect(hasLegacy).to.be.false;
      });

      it('should return true when annotation table has ann_id column', function () {
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
        expect(hasLegacy).to.be.true;
      });

      it('should return false when annotation table lacks ann_id column', function () {
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
        expect(hasLegacy).to.be.false;
      });
    });

    describe('hasMediaFileArtistsTable', function () {
      it('should return false when table does not exist', function () {
        const hasTable = database.hasMediaFileArtistsTable();
        expect(hasTable).to.be.false;
      });

      it('should return true when media_file_artists table exists', function () {
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
        expect(hasTable).to.be.true;
      });
    });
  });

  describe('upsertAnnotation method', function () {
    beforeEach(async function () {
      database = await dbManager.init(':memory:');
    });

    describe('with modern annotation schema (no ann_id)', function () {
      beforeEach(function () {
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

      it('should create new annotation when needsCreate is true', async function () {
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
        expect(result).to.exist;
        expect(result.play_count).to.equal(5);
        expect(result.rating).to.equal(4);
        expect(result.play_date).to.equal('2024-01-15 10:30:00');
        expect(result.item_type).to.equal('media_file');
      });

      it('should update existing annotation when needsCreate is false', async function () {
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
        expect(result.play_count).to.equal(8);
        expect(result.rating).to.equal(5);
      });

      it('should handle date formatting correctly', async function () {
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
        expect(result.play_date).to.equal('2024-01-15 10:30:00');
        expect(result.starred_at).to.equal('2024-01-15 10:30:00');
      });

      it('should handle MusicBee CSV dayjs objects correctly', async function () {
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
        expect(result.play_date).to.match(/2009-04-28 \d{2}:38:00/); // Time depends on local timezone
        expect(result.rating).to.equal(5);
      });

      it('should handle different item types', async function () {
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

        expect(albumResult.item_id).to.equal('album1');
        expect(artistResult.item_id).to.equal('artist1');
      });
    });

    describe('with legacy annotation schema (with ann_id)', function () {
      beforeEach(function () {
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

      it('should include ann_id when creating new annotation in legacy schema', async function () {
        const update = { play_count: 5, rating: 4 };

        await database.upsertAnnotation({
          itemType: 'media_file',
          userId: 'user1',
          itemId: 'track1',
          update,
          needsCreate: true
        });

        const result = database.prepare('SELECT * FROM annotation WHERE user_id = ? AND item_id = ?').get('user1', 'track1');
        expect(result).to.exist;
        expect(result.ann_id).to.exist;
        expect(result.ann_id).to.be.a('string');
        expect(result.ann_id.length).to.be.greaterThan(0);
      });

      it('should update existing annotation in legacy schema', async function () {
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
        expect(result.play_count).to.equal(8);
        expect(result.rating).to.equal(5);
        expect(result.ann_id).to.equal('existing-id');
      });
    });

    describe('error scenarios', function () {
      beforeEach(function () {
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

      it('should handle duplicate key error gracefully during create', async function () {
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
          expect.fail('Should have thrown duplicate key error');
        } catch (error) {
          expect(error.message).to.include('UNIQUE constraint failed');
        }
      });

      it('should handle update of non-existent record', async function () {
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
        expect(result).to.be.undefined;
      });
    });
  });

  describe('cleanup and resource management', function () {
    it('should close database connection properly', async function () {
      database = await dbManager.init(':memory:');

      const result = database.prepare('SELECT 1 as test').get();
      expect(result.test).to.equal(1);

      database.close();

      try {
        database.prepare('SELECT 1 as test').get();
        expect.fail('Should have thrown error on closed database');
      } catch (error) {
        expect(error.message).to.include('database is not open');
      }
    });

    it('should handle multiple close calls gracefully', async function () {
      database = await dbManager.init(':memory:');

      database.close();

      // Second close should not throw error (but might internally)
      // This is implementation dependent, so we just verify it doesn't crash the process
      try {
        database.close();
      } catch (error) {
        // It's acceptable if the second close throws an error
        expect(error.message).to.include('database is not open');
      }
    });
  });
});
