const { DataTypes } = require('sequelize');

exports.attributes = {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  path: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  title: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  album: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  album_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  artist_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  album_artist: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  album_artist_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '' }
};

exports.options = {
  tableName: 'media_file',
  timestamps: false
};
