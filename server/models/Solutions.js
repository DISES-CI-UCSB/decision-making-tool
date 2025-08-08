import { Model, DataTypes } from "sequelize";
import { sequelize } from "../config/connection.js";

class Solutions extends Model {}

Solutions.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    project_id: {
        type: DataTypes.INTEGER,
        references: {
            model: "projects",
            key: "id",
        },
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    author_id: {
        type: DataTypes.INTEGER,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    author_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    author_email: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    user_group: {
      type: DataTypes.ENUM("public", "planner", "manager"),
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "solutions",
    tableName: "solutions",
    timestamps: true,
  }
);

export default Solutions;
