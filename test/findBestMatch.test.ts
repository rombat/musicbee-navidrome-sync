import assert from 'node:assert';
import { describe, it } from 'node:test';

import { findBestMatch } from '../lib/helpers.js';

describe('findBestMatch', () => {
  it('should return the best matching path', () => {
    const mbTrack = {
      filePath: 'V:\\data\\media\\music\\Soundtracks Author\\Carpenter Brut\\Carpenter Brut - 2018 - Leather Teeth',
      filename: '01 - Leather Teeth.mp3'
    };
    const ndTracks = [
      {
        path: '/music/lidarr/Electro Retrowave/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3'
      },
      {
        path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3'
      }
    ];
    const expectedMatch = {
      path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3'
    };
    const result = findBestMatch(mbTrack, ndTracks);
    assert.deepStrictEqual(result, expectedMatch);
  });

  it('should handle paths with different lengths', () => {
    const mbTrack = { filePath: 'V:\\data\\media\\music\\Short Path', filename: 'File.mp3' };
    const ndTracks = [
      { path: '/music/whatever/longer/length/Short Path/File.mp3' },
      { path: '/music/lidarr/Short Path/Another File.mp3' }
    ];
    const expectedMatch = { path: '/music/whatever/longer/length/Short Path/File.mp3' };
    const result = findBestMatch(mbTrack, ndTracks);
    assert.deepStrictEqual(result, expectedMatch);
  });

  it('should return undefined if no match is found', () => {
    const mbTrack = { filePath: 'V:\\data\\media\\music\\Nonexistent Path', filename: 'Nonexistent File.mp3' };
    const ndTracks = [
      {
        path: '/music/lidarr/Electro Retrowave/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3'
      },
      {
        path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3'
      }
    ];
    const result = findBestMatch(mbTrack, ndTracks);
    assert.strictEqual(result, undefined);
  });

  it('should return undefined if same filename but no matching path', () => {
    const mbTrack = { filePath: 'V:\\data\\media\\music\\Nonexistent Path', filename: '01 - Leather Teeth.mp3' };
    const ndTracks = [
      {
        path: '/music/lidarr/Electro Retrowave/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3'
      },
      {
        path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3'
      }
    ];
    const result = findBestMatch(mbTrack, ndTracks);
    assert.strictEqual(result, undefined);
  });
});
