import { Sequelize } from 'sequelize';
import { configDotenv } from 'dotenv';

configDotenv()
export const sequelize = new Sequelize({
  dialect: 'postgres',
  database:  process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  dialectOptions: {
    ssl: process.env.DB_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});
