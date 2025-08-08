import { Model, DataTypes } from "sequelize";
import { sequelize } from "../../config/connection";



class Feature extends Model {}

Feature.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    goal: { type: DataTypes.FLOAT, allowNull: false },
    limit_goal: { type: DataTypes.FLOAT, allowNull: false },
    status: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    visible: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    hidden: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    downloadable: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    theme_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "themes",
        key: "id",
      },
    },
    variable_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "variables",
        key: "id",
      },
    },
  },
  {
    sequelize,
    modelName: "features",
    tableName: "features",
    timestamps: true,
  }
);


class Solutions extends Model {}

Solutions.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    author_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    author_email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    mode: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // theme layers
    // weights
    // includes
    // excludes
  },
  {
    sequelize,
    modelName: "solutions",
    tableName: "solutions",
    timestamps: true,
  }
);


module.exports = Solutions;
