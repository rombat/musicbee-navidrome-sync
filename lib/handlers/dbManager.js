// Suppress SQLite experimental warnings by setting warning filter first
const originalProcessEmitWarning = process.emitWarning;
process.emitWarning = function (warning, type, code) {
  if (type === 'ExperimentalWarning' && warning.includes('SQLite')) {
    return;
  }
  return originalProcessEmitWarning.call(this, warning, type, code);
};

const { DatabaseSync, StatementSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

/**
 * Database wrapper class that encapsulates db connection and utilities
 */
class Database {
  constructor(dbFilePath) {
    this.db = new DatabaseSync(dbFilePath);

    const result = this.db.prepare('SELECT 1 as test').get();
    if (result.test !== 1) {
      throw new Error('Database connection test failed');
    }
  }

  /**
   * Check if a table exists in the database
   * @param {string} tableName
   * @returns {boolean}
   */
  tableExists(tableName) {
    const result = this.db
      .prepare(
        `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name=?
     `
      )
      .get(tableName);
    return !!result;
  }

  /**
   * Get table schema information (columns and their properties)
   * @param {string} tableName
   * @returns {Object} - Schema information with column names as keys
   */
  getTableSchema(tableName) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    const schema = {};
    columns.forEach(col => {
      schema[col.name] = {
        type: col.type,
        notNull: !!col.notnull,
        defaultValue: col.dflt_value,
        primaryKey: !!col.pk
      };
    });
    return schema;
  }

  /**
   * Check if annotation table has the legacy ann_id column
   * @returns {boolean} - True if ann_id column exists, false otherwise
   */
  hasLegacyAnnotationSchema() {
    if (!this.tableExists('annotation')) {
      return false;
    }
    const schema = this.getTableSchema('annotation');
    return 'ann_id' in schema;
  }

  /**
   * Check if media_file_artists table exists (new Navidrome schema post BFR >= 0.55.0)
   * @returns {boolean}
   */
  hasMediaFileArtistsTable() {
    return this.tableExists('media_file_artists');
  }

  /**
   * Execute a raw SQL query
   * @param {string} sql
   * @param {Array} params
   * @returns {Array}
   */
  query(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  /**
   * Prepare a statement for reuse
   * @param {string} sql
   * @returns {StatementSync}
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }

  close() {
    this.db.close();
  }

  /**
   * Annotation create/update
   * @param {Object} params - Annotation parameters
   * @param {('media_file' | 'album' | 'artist')} params.itemType
   * @param {string} params.userId
   * @param {string} params.itemId
   * @param {Object} params.update - Update object with new values
   * @param {boolean} params.needsCreate - Whether to create new annotation
   * @returns {Promise<void>}
   */
  async upsertAnnotation({ itemType, userId, itemId, update, needsCreate }) {
    if (update.play_date) {
      const playDate = dayjs.isDayjs(update.play_date) ? update.play_date : dayjs.utc(update.play_date);
      update.play_date = playDate.format('YYYY-MM-DD HH:mm:ss');
    }
    if (update.starred_at) {
      // If already a dayjs object (from CSV), use as-is; if string, treat as UTC
      const starredAt = dayjs.isDayjs(update.starred_at) ? update.starred_at : dayjs.utc(update.starred_at);
      update.starred_at = starredAt.format('YYYY-MM-DD HH:mm:ss');
    }

    if (needsCreate) {
      const record = {
        item_type: itemType,
        user_id: userId,
        item_id: itemId,
        play_count: 0,
        starred: 0,
        rating: 0,
        play_date: null,
        starred_at: null,
        ...update
      };

      if (this.hasLegacyAnnotationSchema()) {
        record.ann_id = randomUUID();
      }

      const columns = Object.keys(record).join(', ');
      const placeholders = Object.keys(record)
        .map(() => '?')
        .join(', ');

      this.prepare(`INSERT INTO annotation (${columns}) VALUES (${placeholders})`).run(...Object.values(record));
    } else {
      const setClauses = Object.keys(update)
        .map(key => `${key} = ?`)
        .join(', ');

      this.prepare(
        `
        UPDATE annotation 
        SET ${setClauses}
        WHERE item_type = ? 
        AND user_id = ? 
        AND item_id = ?
      `
      ).run(...Object.values(update), itemType, userId, itemId);
    }
  }
}

exports.init = async dbFilePath => {
  try {
    const database = new Database(dbFilePath);
    console.log('Connection has been established successfully.');
    return database;
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
};
