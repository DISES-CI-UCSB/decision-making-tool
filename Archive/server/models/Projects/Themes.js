import { Model, DataTypes } from "sequelize";
import { sequelize } from "../../config/connection";

class Theme extends Model {}

Theme.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
  },
  {
    sequelize,
    modelName: "themes",
    tableName: "themes",
    timestamps: true,
  }
);