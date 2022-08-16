const { DataTypes } = require('sequelize');

exports.attributes = {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false, defaultValue: '' }
};

exports.options = {
  tableName: 'artist',
  timestamps: false
};
