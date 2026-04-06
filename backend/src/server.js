import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

import app from "./app.js";
import { testConnection } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

const port = Number(process.env.PORT || 4000);

async function start() {
  try {
    const now = await testConnection();
    console.log(`Database connected at ${now}`);

    app.listen(port, () => {
      console.log(`API listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server", error);
    process.exit(1);
  }
}

start();
