const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

/**
 * Normalize path to use forward slashes
 * @param {string} path
 * @returns {string}
 */
const normalizePath = path => path.replace(/\\/g, '/');

/**
 * Get path segments
 * @param {string} path
 * @returns {string[]}
 */
const getSegments = path => normalizePath(path).split('/');

/**
 * Find best match for a given MusicBee track
 * @param {object} mbTrack
 * @param {object[]} ndTracks
 * @returns {object|undefined}
 */
const findBestMatch = (mbTrack, ndTracks) => {
  const mbTrackSegments = getSegments(mbTrack.filePath).reverse();
  mbTrackSegments.unshift(mbTrack.filename);
  let bestMatch;
  let bestMatchScore = 0;

  ndTracks.filter(Boolean).forEach(ndTrack => {
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
 * @param {dayjs|string|null} dateA - Usually from CSV (dayjs UTC object)
 * @param {string|null} dateB - Usually from database (string)
 * @returns {boolean}
 */
const isDateAfter = (dateA, dateB) => {
  if (!dateA) return false;
  if (!dateB) return true;

  // dateA: If dayjs object (from CSV), use as is; if string, treat as UTC
  const dayjsA = dayjs.isDayjs(dateA) ? dateA : dayjs.utc(dateA);
  
  // dateB: Database strings are already in UTC format, treat them as such
  const dayjsB = dayjs.utc(dateB);

  return dayjsA.isAfter(dayjsB);
};

module.exports = { findBestMatch, isDateAfter };
