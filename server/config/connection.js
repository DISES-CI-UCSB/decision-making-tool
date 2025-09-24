import { Sequelize } from 'sequelize';
import { configDotenv } from 'dotenv';

configDotenv()
console.log(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PW)
export const sequelize = new Sequelize({
  dialect: 'postgres',
  database:  process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PW,
  host: process.env.DB_HOST || 'localhost',
  port: 5432,
  dialectOptions: {
    ssl: process.env.DB_SSL === 'true' ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});
