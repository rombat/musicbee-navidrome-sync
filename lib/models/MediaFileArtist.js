const { DataTypes } = require('sequelize');

exports.attributes = {
  media_file_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  artist_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '', primaryKey: true },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: '', primaryKey: true }
};

exports.options = {
  tableName: 'media_file_artists',
  timestamps: false,
  indexes: [
    {
      fields: ['media_file_id', 'artist_id', 'role'],
      unique: true
    }
  ]
};
