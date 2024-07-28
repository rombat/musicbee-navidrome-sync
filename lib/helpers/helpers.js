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
    const ndTrackSegments = getSegments(ndTrack.toJSON().path).reverse();
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

module.exports = { findBestMatch };
