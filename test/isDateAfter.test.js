import assert from 'node:assert';
import { describe, it } from 'node:test';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(customParseFormat);

import { isDateAfter } from '../lib/helpers.js';

describe('isDateAfter', () => {
  describe('dayjs object vs string comparisons', () => {
    it('should return true when dayjs date is after string date', () => {
      const dayjsDate = dayjs('2025-01-15 10:30:00');
      const stringDate = '2025-01-10 09:00:00';

      const result = isDateAfter(dayjsDate, stringDate);
      assert.strictEqual(result, true);
    });

    it('should return false when dayjs date is before string date', () => {
      const dayjsDate = dayjs('2025-01-05 10:30:00');
      const stringDate = '2025-01-10 09:00:00';

      const result = isDateAfter(dayjsDate, stringDate);
      assert.strictEqual(result, false);
    });

    it('should return false when dayjs date equals string date', () => {
      const testDate = '2025-01-10 09:00:00';
      const dayjsDate = dayjs(testDate);

      const result = isDateAfter(dayjsDate, testDate);
      assert.strictEqual(result, false);
    });
  });

  describe('string vs string comparisons', () => {
    it('should return true when first string date is after second', () => {
      const dateA = '2025-01-15 10:30:00';
      const dateB = '2025-01-10 09:00:00';

      const result = isDateAfter(dateA, dateB);
      assert.strictEqual(result, true);
    });

    it('should return false when first string date is before second', () => {
      const dateA = '2025-01-05 10:30:00';
      const dateB = '2025-01-10 09:00:00';

      const result = isDateAfter(dateA, dateB);
      assert.strictEqual(result, false);
    });

    it('should return false when string dates are equal', () => {
      const dateA = '2025-01-10 09:00:00';
      const dateB = '2025-01-10 09:00:00';

      const result = isDateAfter(dateA, dateB);
      assert.strictEqual(result, false);
    });
  });

  describe('null and undefined handling', () => {
    it('should return false when first date is null', () => {
      const result = isDateAfter(null, '2025-01-10 09:00:00');
      assert.strictEqual(result, false);
    });

    it('should return false when first date is undefined', () => {
      const result = isDateAfter(undefined, '2025-01-10 09:00:00');
      assert.strictEqual(result, false);
    });

    it('should return true when second date is null and first is valid', () => {
      const dayjsDate = dayjs('2025-01-15 10:30:00');
      const result = isDateAfter(dayjsDate, null);
      assert.strictEqual(result, true);
    });

    it('should return true when second date is undefined and first is valid', () => {
      const stringDate = '2025-01-15 10:30:00';
      const result = isDateAfter(stringDate, undefined);
      assert.strictEqual(result, true);
    });

    it('should return false when both dates are null', () => {
      const result = isDateAfter(null, null);
      assert.strictEqual(result, false);
    });

    it('should return false when both dates are undefined', () => {
      const result = isDateAfter(undefined, undefined);
      assert.strictEqual(result, false);
    });
  });

  describe('edge cases', () => {
    it('should handle different date formats correctly', () => {
      const dayjsDate = dayjs('2025-01-15T10:30:00Z');
      const stringDate = '2025-01-10 09:00:00';

      const result = isDateAfter(dayjsDate, stringDate);
      assert.strictEqual(result, true);
    });

    it('should handle milliseconds precision', () => {
      const dayjsDate = dayjs.utc('2025-01-10 09:00:00.001');
      const stringDate = '2025-01-10 09:00:00.000';

      const result = isDateAfter(dayjsDate, stringDate);
      assert.strictEqual(result, true);
    });

    it('should handle timezone differences', () => {
      const dayjsDate = dayjs.utc('2025-01-15 10:30:00');
      const stringDate = '2025-01-15 08:30:00'; // 2 hours earlier

      const result = isDateAfter(dayjsDate, stringDate);
      assert.strictEqual(result, true);
    });

    it('should return false when first date is empty string', () => {
      const result = isDateAfter('', '2025-01-10 09:00:00');
      assert.strictEqual(result, false);
    });

    it('should return true when second date is empty string and first is valid', () => {
      const dayjsDate = dayjs.utc('2025-01-15 10:30:00');
      const result = isDateAfter(dayjsDate, '');
      assert.strictEqual(result, true);
    });
  });

  describe('real-world scenarios from codebase', () => {
    it('should handle CSV date (dayjs UTC) vs database date (string) - newer CSV', () => {
      // Simulate CSV processing: lastPlayed from MusicBee (UTC)
      const csvLastPlayed = dayjs.utc('2025-01-15 10:30:00');
      // Simulate database: play_date from annotation table
      const dbPlayDate = '2025-01-10 09:00:00';

      const result = isDateAfter(csvLastPlayed, dbPlayDate);
      assert.strictEqual(result, true);
    });

    it('should handle album/artist aggregated dates (string vs string)', () => {
      // Simulate album stats: tracks_last_played vs album_last_played
      const tracksLastPlayed = '2025-01-15 10:30:00';
      const albumLastPlayed = '2025-01-10 09:00:00';

      const result = isDateAfter(tracksLastPlayed, albumLastPlayed);
      assert.strictEqual(result, true);
    });

    it('should handle new annotations (CSV vs null database)', () => {
      // New track that has no existing annotation
      const csvLastPlayed = dayjs.utc('2025-01-15 10:30:00');
      const dbPlayDate = null;

      const result = isDateAfter(csvLastPlayed, dbPlayDate);
      assert.strictEqual(result, true);
    });

    it('should handle timezone differences consistently', () => {
      // CSV date in UTC
      const csvDate = dayjs.utc('2025-01-15 10:30:00');
      // Database date that could be interpreted as local time
      const dbDate = '2025-01-15 06:30:00'; // 4 hours earlier (different timezone)

      const result = isDateAfter(csvDate, dbDate);
      assert.strictEqual(result, true); // UTC comparison should be consistent
    });

    it('should handle MusicBee CSV format vs database storage (same date)', () => {
      // Simulate exact MusicBee scenario
      const musicbeeDate = '28/04/2009 07:38';
      const format = 'DD/MM/YYYY HH:mm';

      // Parse as done in CSV processing
      const csvParsedDate = dayjs(musicbeeDate, format).utc();

      // Simulate what gets stored in database (should be the same moment in UTC)
      const dbStoredDate = csvParsedDate.format('YYYY-MM-DD HH:mm:ss');

      const result = isDateAfter(csvParsedDate, dbStoredDate);
      assert.strictEqual(result, false); // Should be false - same dates
    });

    it('should handle MusicBee CSV format vs database storage (newer CSV)', () => {
      // Simulate MusicBee scenario with newer CSV date
      const musicbeeDate = '28/04/2009 07:39'; // 1 minute later
      const format = 'DD/MM/YYYY HH:mm';

      const csvParsedDate = dayjs(musicbeeDate, format).utc();
      const olderDbDate = '2009-04-28 05:38:00'; // 1 minute earlier in UTC

      const result = isDateAfter(csvParsedDate, olderDbDate);
      assert.strictEqual(result, true); // Should be true - CSV is newer
    });
  });
});
