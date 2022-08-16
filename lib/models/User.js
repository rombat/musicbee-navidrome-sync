const { DataTypes } = require('sequelize');

exports.attributes = {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  user_name: { type: DataTypes.STRING, allowNull: false, defaultValue: '' }
};

exports.options = {
  tableName: 'user',
  timestamps: false
};
