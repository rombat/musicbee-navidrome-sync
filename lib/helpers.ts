import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);

type MBTrackForMatch = { filePath: string; filename: string };
type WithPath = { path: string };

/**
 * Normalize path to use forward slashes
 */
const normalizePath = (path: string): string => path.replace(/\\/g, '/');

/**
 * Get path segments
 */
const getSegments = (path: string): string[] => normalizePath(path).split('/');

/**
 * Find best match for a given MusicBee track based on filename and path segments
 */
const findBestMatch = <T extends WithPath>(
  mbTrack: MBTrackForMatch,
  ndTracks: ReadonlyArray<T | null | undefined>
): T | undefined => {
  const mbTrackSegments = getSegments(mbTrack.filePath).reverse();
  mbTrackSegments.unshift(mbTrack.filename);
  let bestMatch: T | undefined;
  let bestMatchScore = 0;

  ndTracks
    .filter((t): t is T => Boolean(t))
    .forEach(ndTrack => {
      const ndTrackSegments = getSegments(ndTrack.path).reverse();
      let matchScore = 0;

      if (mbTrackSegments[0] !== ndTrackSegments[0]) {
        return;
      }
      for (let i = 1; i <= Math.min(mbTrackSegments.length, ndTrackSegments.length); i++) {
        if (mbTrackSegments[i] === ndTrackSegments[i]) {
          matchScore++;
        } else {
          break;
        }
      }
      if (matchScore > bestMatchScore) {
        bestMatchScore = matchScore;
        bestMatch = ndTrack;
      }
    });

  return bestMatch;
};

/**
 * Safe date comparison - handles dayjs objects vs database strings
 * All comparisons are done in UTC to ensure consistency
 * dateA usually comes from CSV (already a dayjs UTC object)
 * dateB usually comes from the database as a UTC-formatted string
 */
const isDateAfter = (dateA: Dayjs | string | null | undefined, dateB: string | null | undefined): boolean => {
  if (!dateA) {
    return false;
  }
  if (!dateB) {
    return true;
  }

  const dayjsA = dayjs.isDayjs(dateA) ? dateA : dayjs.utc(dateA);
  const dayjsB = dayjs.utc(dateB);

  return dayjsA.isAfter(dayjsB);
};

export type { MBTrackForMatch, WithPath };
export { findBestMatch, isDateAfter };
