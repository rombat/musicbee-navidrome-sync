const { Sequelize } = require('sequelize');
const TrackDefinition = require('../models/Track');
const AlbumDefinition = require('../models/Album');
const AnnotationDefinition = require('../models/Annotation');
const ArtistDefinition = require('../models/Artist');
const UserDefinition = require('../models/User');
const MediaFileArtistDefinition = require('../models/MediaFileArtist');

exports.init = async dbFilePath => {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbFilePath,
    logging: !!process.env.DEBUG
  });
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }

  await createRelationships(sequelize);

  return sequelize;
};

const createRelationships = async sequelize => {
  // handling legacy Annotation schema (ann_id removed from navidrome DB schema in this commit: https://github.com/navidrome/navidrome/commit/47378c68828861751b9d1a05d3fc9b29ce8dd9f0)
  const annotationTableSchema = await sequelize.getQueryInterface().describeTable('annotation');

  // Following Big Fucking Refactor (Navidrome >= 0.55.0), many-to-many relationship exists between Track and Artist via MediaFileArtist table.
  const hasMediaFileArtists = await sequelize.getQueryInterface().tableExists('media_file_artists');

  const Track = sequelize.define('Track', TrackDefinition.attributes, TrackDefinition.options);
  const Album = sequelize.define('Album', AlbumDefinition.attributes, AlbumDefinition.options);
  const Annotation = sequelize.define(
    'Annotation',
    AnnotationDefinition.getAttributes(annotationTableSchema),
    AnnotationDefinition.options
  );
  const Artist = sequelize.define('Artist', ArtistDefinition.attributes, ArtistDefinition.options);
  const User = sequelize.define('User', UserDefinition.attributes, UserDefinition.options);

  Track.belongsTo(Album, { foreignKey: 'album_id' });
  Track.hasOne(Annotation, { as: 'trackAnnotation', foreignKey: 'item_id' });

  if (!hasMediaFileArtists) {
    Artist.hasMany(Track, { as: 'tracks', foreignKey: 'artist_id' });
    Track.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });
  } else {
    const MediaFileArtist = sequelize.define(
      'MediaFileArtist',
      MediaFileArtistDefinition.attributes,
      MediaFileArtistDefinition.options
    );

    Artist.belongsToMany(Track, {
      through: {
        model: MediaFileArtist,
        scope: {
          role: 'artist'
        }
      },
      foreignKey: 'artist_id',
      otherKey: 'media_file_id',
      as: 'tracks'
    });

    Track.belongsToMany(Artist, {
      through: {
        model: MediaFileArtist,
        scope: {
          role: 'artist'
        }
      },
      foreignKey: 'media_file_id',
      otherKey: 'artist_id',
      as: 'artists'
    });
  }

  Artist.hasOne(Annotation, { as: 'artistAnnotation', foreignKey: 'item_id' });

  Album.hasMany(Track, { as: 'tracks', foreignKey: 'album_id' });
  Album.hasOne(Annotation, { as: 'albumAnnotation', foreignKey: 'item_id' });

  Annotation.belongsTo(Track, { as: 'track', foreignKey: 'item_id' });
  Annotation.belongsTo(Album, { as: 'album', foreignKey: 'item_id' });
  Annotation.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
};
