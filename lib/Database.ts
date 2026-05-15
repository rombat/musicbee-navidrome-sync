import { randomUUID } from 'node:crypto';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

export type ColumnInfo = {
  type: string;
  notNull: boolean;
  defaultValue: unknown;
  primaryKey: boolean;
};

export type TableSchema = Record<string, ColumnInfo>;

export type AnnotationItemType = 'media_file' | 'album' | 'artist';

export type AnnotationUpdate = {
  play_count?: number;
  starred?: number;
  rating?: number;
  play_date?: Dayjs | string | null;
  starred_at?: Dayjs | string | null;
  ann_id?: string;
};

export type UpsertAnnotationParams = {
  itemType: AnnotationItemType;
  userId: string;
  itemId: string;
  update: AnnotationUpdate;
  needsCreate: boolean;
};

type PragmaTableInfoRow = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

/**
 * Database wrapper class that encapsulates db connection and utilities
 */
class Database {
  private readonly db: DatabaseSync;

  constructor(dbFilePath: string) {
    this.db = new DatabaseSync(dbFilePath);

    const result = this.db.prepare('SELECT 1 as test').get() as { test: number } | undefined;
    if (!result || result.test !== 1) {
      throw new Error('Database connection test failed');
    }

    this.db.exec('PRAGMA journal_mode=DELETE;'); // slightly slower, but avoid using WAL log, which isn't necessarily removed when the db is closed
    this.db.exec('PRAGMA synchronous=NORMAL;');
    this.db.exec('PRAGMA temp_store=MEMORY;');
    this.db.exec('PRAGMA cache_size=-100000;'); // 100Mb
  }

  tableExists(tableName: string): boolean {
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

  getTableSchema(tableName: string): TableSchema {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as PragmaTableInfoRow[];
    const schema: TableSchema = {};
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

  hasLegacyAnnotationSchema(): boolean {
    if (!this.tableExists('annotation')) {
      return false;
    }
    const schema = this.getTableSchema('annotation');
    return 'ann_id' in schema;
  }

  hasMediaFileArtistsTable(): boolean {
    return this.tableExists('media_file_artists');
  }

  query<T = Record<string, unknown>>(sql: string, params: SQLInputValue[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  async executeTransaction(callback: () => void | Promise<void>): Promise<void> {
    this.db.exec('BEGIN TRANSACTION');
    try {
      await callback();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  upsertAnnotation({ itemType, userId, itemId, update, needsCreate }: UpsertAnnotationParams): void {
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
      const record: Record<string, SQLInputValue> = {
        item_type: itemType,
        user_id: userId,
        item_id: itemId,
        play_count: 0,
        starred: 0,
        rating: 0,
        play_date: null,
        starred_at: null,
        ...(update as Record<string, SQLInputValue>)
      };

      if (this.hasLegacyAnnotationSchema()) {
        record.ann_id = randomUUID();
      }

      const columns = Object.keys(record).join(', ');
      const placeholders = Object.keys(record)
        .map(() => '?')
        .join(', ');

      this.db.prepare(`INSERT INTO annotation (${columns}) VALUES (${placeholders})`).run(...Object.values(record));
    } else {
      const setClauses = Object.keys(update)
        .map(key => `${key} = ?`)
        .join(', ');

      this.db
        .prepare(
          `
        UPDATE annotation
        SET ${setClauses}
        WHERE item_type = ?
        AND user_id = ?
        AND item_id = ?
      `
        )
        .run(...(Object.values(update) as SQLInputValue[]), itemType, userId, itemId);
    }
  }
}

export const init = (dbFilePath: string): Database => {
  try {
    const database = new Database(dbFilePath);
    console.log('Connection has been established successfully.');
    return database;
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
};

export { Database };
