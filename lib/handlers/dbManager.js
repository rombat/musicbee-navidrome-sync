const { Sequelize } = require('sequelize');
const TrackDefinition = require('../models/Track');
const AlbumDefinition = require('../models/Album');
const AnnotationDefinition = require('../models/Annotation');
const ArtistDefinition = require('../models/Artist');
const UserDefinition = require('../models/User');

exports.init = async options => {
  const sequelize = await createConnection(options);

  createRelationships(sequelize);

  return sequelize;
};

const createConnection = async options => {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './data/navidrome.db',
    logging: !!options.verbose
  });
  try {
    await sequelize.authenticate();
    console.log('Connection has been established successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
  return sequelize;
};

const createRelationships = sequelize => {
  const Track = sequelize.define('Track', TrackDefinition.attributes, TrackDefinition.options);
  const Album = sequelize.define('Album', AlbumDefinition.attributes, AlbumDefinition.options);
  const Annotation = sequelize.define('Annotation', AnnotationDefinition.attributes, AnnotationDefinition.options);
  const Artist = sequelize.define('Artist', ArtistDefinition.attributes, ArtistDefinition.options);
  const User = sequelize.define('User', UserDefinition.attributes, UserDefinition.options);

  Track.belongsTo(Album, { foreignKey: 'album_id' });
  Track.hasOne(Annotation, { as: 'trackAnnotation', foreignKey: 'item_id' });
  Track.belongsTo(Artist, { as: 'artist', foreignKey: 'artist_id' });

  Artist.hasMany(Track, { as: 'tracks', foreignKey: 'artist_id' });
  Artist.hasOne(Annotation, { as: 'artistAnnotation', foreignKey: 'item_id' });

  Album.hasMany(Track, { as: 'tracks', foreignKey: 'album_id' });
  Album.hasOne(Annotation, { as: 'albumAnnotation', foreignKey: 'item_id' });

  Annotation.belongsTo(Track, { as: 'track', foreignKey: 'item_id' });
  Annotation.belongsTo(Album, { as: 'album', foreignKey: 'item_id' });
  Annotation.belongsTo(User, { as: 'user', foreignKey: 'user_id' });
};
