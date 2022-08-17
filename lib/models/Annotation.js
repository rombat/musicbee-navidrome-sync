const { DataTypes } = require('sequelize');
const dayjs = require('dayjs');

exports.attributes = {
  ann_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  user_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  item_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  item_type: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  play_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  play_date: {
    type: DataTypes.STRING,
    defaultValue: null,
    set(value) {
      const date = dayjs(value);
      this.setDataValue('play_date', date.format('YYYY-MM-DD HH:mm:ss'));
    }
  },
  rating: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0, max: 5 } },
  starred: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  starred_at: {
    type: DataTypes.STRING,
    defaultValue: null,
    set(value) {
      const date = dayjs(value);
      this.setDataValue('starred_at', date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : null);
    }
  }
};

exports.options = {
  tableName: 'annotation',
  timestamps: false
};
