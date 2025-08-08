import { Model, DataTypes } from "sequelize";
import { sequelize } from "../config/connection.js";

class Layers extends Model {}

Layers.init(
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
    type: {
      type: DataTypes.ENUM("theme", "weight", "include", "exclude"),
      allowNull: false,
    },
    theme: {
      type: DataTypes.STRING, // Example: "Species at Risk (ECCC)"
      allowNull: true,
    },
    file_id: {
      type: DataTypes.INTEGER, // e.g., "T_ECCC_SAR_Agalinis_gattingeri.tif"
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING, // Used in table of contents
      allowNull: false,
    },
    legend: {
      type: DataTypes.ENUM("manual", "continuous"),
      allowNull: true,
    },
    values: {
      type: DataTypes.ARRAY(DataTypes.STRING), // e.g., ['0', '1']
      allowNull: true,
    },
    color: {
      type: DataTypes.ARRAY(DataTypes.STRING), // e.g., ['#00000000', '#b3de69']
      allowNull: true,
    },
    labels: {
      type: DataTypes.ARRAY(DataTypes.STRING), // e.g., ['absence', 'presence']
      allowNull: true,
    },
    unit: {
      type: DataTypes.STRING, // e.g., "km2"
      allowNull: true,
    },
    provenance: {
      type: DataTypes.ENUM("regional", "national", "missing"),
      allowNull: true,
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    visible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    hidden: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    goal: {
      type: DataTypes.FLOAT, // Value between 0 and 1
      allowNull: true,
      validate: {
        min: 0,
        max: 1,
      },
    },
    downloadable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: "layers",
    tableName: "layers",
    timestamps: true,
  }
);

export default Layers;
