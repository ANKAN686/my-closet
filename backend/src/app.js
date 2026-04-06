import cors from "cors";
import express from "express";

import categoriesRouter from "./routes/categories.js";
import itemsRouter from "./routes/items.js";
import outfitsRouter from "./routes/outfits.js";
import usersRouter from "./routes/users.js";
import wearLogsRouter from "./routes/wearLogs.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "my-closet-api" });
});

app.use("/api/users", usersRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/items", itemsRouter);
app.use("/api/outfits", outfitsRouter);
app.use("/api/wear-logs", wearLogsRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
