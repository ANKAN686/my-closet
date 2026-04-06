import dotenv from "dotenv";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Set it in backend/.env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function testConnection() {
  const result = await pool.query("SELECT NOW() AS now");
  return result.rows[0]?.now;
}

export async function closePool() {
  await pool.end();
}
