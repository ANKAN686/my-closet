import dotenv from "dotenv";

import app from "./app.js";
import { testConnection } from "./db.js";

dotenv.config();

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
