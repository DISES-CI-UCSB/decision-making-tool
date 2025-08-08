import { Model, DataTypes } from "sequelize";
import { sequelize } from "../../config/connection";

class Weight extends Model {}

Weight.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    factor: { type: DataTypes.FLOAT, allowNull: false },
    status: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    visible: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    hidden: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
    downloadable: { type: DataTypes.ENUM("yes", "no"), allowNull: false },
  },
  {
    sequelize,
    modelName: "weights",
    tableName: "weights",
    timestamps: true,
  }
);
