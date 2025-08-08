import { Model, DataTypes } from "sequelize";
import { sequelize } from "../../config/connection";

class Excludes extends Model {}

Excludes.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    mandatory: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    status: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    visible: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    hidden: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    downloadable: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    overlap: { type: DataTypes.STRING, allowNull: true },
  },
  {
    sequelize,
    modelName: "excludes",
    tableName: "excludes",
    timestamps: true,
  }
);