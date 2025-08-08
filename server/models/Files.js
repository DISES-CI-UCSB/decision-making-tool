import { Model, DataTypes } from "sequelize";
import { sequelize } from "../config/connection.js";

class Files extends Model {}

Files.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    uploader_id: {
      type: DataTypes.INTEGER,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    path: {
      type: DataTypes.STRING, // e.g., "T_ECCC_SAR_Agalinis_gattingeri.tif"
      allowNull: true,
    },
    
  },
  {
    sequelize,
    modelName: "files",
    tableName: "files",
    timestamps: true,
  }
);

export default Files;
