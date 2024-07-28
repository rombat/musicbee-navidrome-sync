const chai = require('chai');
const expect = chai.expect;
const { findBestMatch } = require('../lib/helpers/helpers');

describe('findBestMatch', function () {
  function toJSON() {
    const { toJSON, ...rest } = this;
    return rest;
  }
  it('should return the best matching path', function () {
    const mbTrack = {
      filePath: 'V:\\data\\media\\music\\Soundtracks Author\\Carpenter Brut\\Carpenter Brut - 2018 - Leather Teeth',
      filename: '01 - Leather Teeth.mp3'
    };
    const ndTracks = [
      {
        path: '/music/lidarr/Electro Retrowave/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3',
        toJSON
      },
      {
        path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3',
        toJSON
      }
    ];
    const expectedMatch = {
      path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3',
      toJSON
    };
    const result = findBestMatch(mbTrack, ndTracks);
    expect(result).to.deep.equal(expectedMatch);
  });

  it('should handle paths with different lengths', function () {
    const mbTrack = { filePath: 'V:\\data\\media\\music\\Short Path', filename: 'File.mp3' };
    const ndTracks = [
      { path: '/music/whatever/longer/length/Short Path/File.mp3', toJSON },
      { path: '/music/lidarr/Short Path/Another File.mp3', toJSON }
    ];
    const expectedMatch = { path: '/music/whatever/longer/length/Short Path/File.mp3', toJSON };
    const result = findBestMatch(mbTrack, ndTracks);
    expect(result).to.deep.equal(expectedMatch);
  });

  it('should return undefined if no match is found', function () {
    const mbTrack = { filePath: 'V:\\data\\media\\music\\Nonexistent Path', filename: 'Nonexistent File.mp3' };
    const ndTracks = [
      {
        path: '/music/lidarr/Electro Retrowave/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3',
        toJSON
      },
      {
        path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3',
        toJSON
      }
    ];
    const result = findBestMatch(mbTrack, ndTracks);
    expect(result).to.be.undefined;
  });

  it('should return undefined if same filename but no matching path', function () {
    const mbTrack = { filePath: 'V:\\data\\media\\music\\Nonexistent Path', filename: '01 - Leather Teeth.mp3' };
    const ndTracks = [
      {
        path: '/music/lidarr/Electro Retrowave/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3',
        toJSON
      },
      {
        path: '/music/lidarr/Soundtracks Author/Carpenter Brut/Carpenter Brut - 2018 - Leather Teeth/01 - Leather Teeth.mp3',
        toJSON
      }
    ];
    const result = findBestMatch(mbTrack, ndTracks);
    expect(result).to.be.undefined;
  });
});
