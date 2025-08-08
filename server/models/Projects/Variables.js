import { Model, DataTypes } from "sequelize";
import { sequelize } from "../../config/connection";

class Variable extends Model {}
// will be used by Features, Weights, and Includes
Variable.init(
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    project_id: {
      type: DataTypes.INTEGER,
      references: {
        model: "projects",
        key: "id",
      },
    },
    type: {
      type: DataTypes.ENUM("theme", "weight", "include", "exclude"),
      allowNull: false,
    },
    file: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    units: { type: DataTypes.STRING, allowNull: false },
    provenance: { type: DataTypes.STRING, allowNull: false },
    legend_type: {
      type: DataTypes.ENUM("manual", "continuous"),
      allowNull: false,
    },
    legend_colors: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      allowNull: false,
    },
    legend_labels: { type: DataTypes.ARRAY(DataTypes.STRING), allowNull: true }, // only for manual legends
  },
  {
    sequelize,
    modelName: "variables",
    tableName: "variables",
    timestamps: true,
  }
);
