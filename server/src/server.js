import dotenv from "dotenv";
import connect_db from './config/db.js'
import express from 'express';

dotenv.config();

const app = express();

const db_url = process.env.MONGODB_URL;
const port = process.env.PORT || 3000;

connect_db(db_url);

app.listen(port,()=>{
  console.log(`Server is running at http://localhost:${port}`);
});