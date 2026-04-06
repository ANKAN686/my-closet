import express from "express";

import { query } from "../db.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { user_id, clothing_item_id } = req.query;
    const filters = [];
    const values = [];

    if (user_id) {
      values.push(user_id);
      filters.push(`w.user_id = $${values.length}`);
    }

    if (clothing_item_id) {
      values.push(clothing_item_id);
      filters.push(`w.clothing_item_id = $${values.length}`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await query(
      `SELECT
        w.id,
        w.user_id,
        w.clothing_item_id,
        i.name AS item_name,
        w.outfit_id,
        o.name AS outfit_name,
        w.worn_on,
        w.notes
       FROM wear_logs w
       LEFT JOIN clothing_items i ON i.id = w.clothing_item_id
       LEFT JOIN outfits o ON o.id = w.outfit_id
       ${whereClause}
       ORDER BY w.worn_on DESC, w.id DESC`,
      values
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { user_id, clothing_item_id, outfit_id, worn_on, notes } = req.body;

    if (!user_id || !clothing_item_id) {
      return res
        .status(400)
        .json({ error: "user_id and clothing_item_id are required" });
    }

    const result = await query(
      `INSERT INTO wear_logs (user_id, clothing_item_id, outfit_id, worn_on, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        user_id,
        clothing_item_id,
        outfit_id ?? null,
        worn_on ?? new Date().toISOString().slice(0, 10),
        notes ?? null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await query("DELETE FROM wear_logs WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Wear log not found" });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
