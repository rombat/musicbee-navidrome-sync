const { DataTypes } = require('sequelize');
const dayjs = require('dayjs');

exports.getAttributes = existingSchema => {
  const defaultAttributes = {
    ann_id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    user_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '', primaryKey: true },
    item_id: { type: DataTypes.STRING, allowNull: false, defaultValue: '', primaryKey: true },
    item_type: { type: DataTypes.STRING, allowNull: false, defaultValue: '', primaryKey: true },
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
  if (!existingSchema.ann_id) {
    delete defaultAttributes.ann_id;
  }
  return defaultAttributes;
};

exports.options = {
  tableName: 'annotation',
  timestamps: false,
  indexes: [
    {
      fields: ['user_id', 'item_id', 'item_type'],
      unique: true
    }
  ]
};
