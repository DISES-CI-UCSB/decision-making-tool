import { Model, DataTypes } from "sequelize";
import { sequelize } from "../config/connection.js";

class SolutionLayers extends Model {}

SolutionLayers.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    solution_id: {
      type: DataTypes.INTEGER,
      references: {
        model: "solutions",
        key: "id",
      },
    },
    project_layer_id: {
      type: DataTypes.INTEGER,
      references: {
        model: "project_layers",
        key: "id"
      },
    },
    goal: {
      type: DataTypes.FLOAT, // Value between 0 and 1, Null for solution layers
      allowNull: true,
      validate: {
        min: 0,
        max: 1,
      },
    },
  },
  {
    sequelize,
    modelName: "solutionlayers",
    tableName: "solution_layers",
    timestamps: true,
  }
);

export default SolutionLayers;
