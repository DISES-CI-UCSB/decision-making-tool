import { Model, DataTypes } from "sequelize";
import { sequelize } from "../config/connection.js";

class Projects extends Model {}

Projects.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
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
    owner_id: {
      type: DataTypes.INTEGER,
      references: {
            model: "users",
            key: "id",
      },
    },
    user_group: {
      type: DataTypes.ENUM("public", "planner", "manager"),
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: "projects",
    tableName: "projects",
    timestamps: true,
  }
);

export default Projects;
