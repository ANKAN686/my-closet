import express from "express";

import { query } from "../db.js";

const router = express.Router();

router.get("/", async (_req, res, next) => {
  try {
    const result = await query(
      "SELECT id, email, full_name, created_at FROM users ORDER BY id"
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await query(
      "SELECT id, email, full_name, created_at FROM users WHERE id = $1",
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { email, full_name } = req.body;

    if (!email || !full_name) {
      return res.status(400).json({ error: "email and full_name are required" });
    }

    const result = await query(
      "INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id, email, full_name, created_at",
      [email, full_name]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const { email, full_name } = req.body;

    const result = await query(
      `UPDATE users
       SET email = COALESCE($1, email),
           full_name = COALESCE($2, full_name)
       WHERE id = $3
       RETURNING id, email, full_name, created_at`,
      [email ?? null, full_name ?? null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await query("DELETE FROM users WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
