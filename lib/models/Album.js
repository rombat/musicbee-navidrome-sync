const { DataTypes } = require('sequelize');

exports.attributes = {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  song_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  album_artist: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  album_artist_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '' }
};

exports.options = {
  tableName: 'album',
  timestamps: false
};
