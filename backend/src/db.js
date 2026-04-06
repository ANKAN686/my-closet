import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

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
