import express from "express";

import { query } from "../db.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { user_id } = req.query;

    const values = [];
    const whereClause = user_id ? "WHERE o.user_id = $1" : "";
    if (user_id) values.push(user_id);

    const result = await query(
      `SELECT
        o.id,
        o.user_id,
        o.name,
        o.occasion,
        o.season,
        o.is_favorite,
        o.created_at,
        o.updated_at,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'item_id', i.id,
              'item_name', i.name,
              'item_brand', i.brand,
              'item_color', i.color
            )
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS items
      FROM outfits o
      LEFT JOIN outfit_items oi ON oi.outfit_id = o.id
      LEFT JOIN clothing_items i ON i.id = oi.clothing_item_id
      ${whereClause}
      GROUP BY o.id
      ORDER BY o.created_at DESC`,
      values
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
        o.id,
        o.user_id,
        o.name,
        o.occasion,
        o.season,
        o.is_favorite,
        o.created_at,
        o.updated_at,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'item_id', i.id,
              'item_name', i.name,
              'item_brand', i.brand,
              'item_color', i.color
            )
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS items
      FROM outfits o
      LEFT JOIN outfit_items oi ON oi.outfit_id = o.id
      LEFT JOIN clothing_items i ON i.id = oi.clothing_item_id
      WHERE o.id = $1
      GROUP BY o.id`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Outfit not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { user_id, name, occasion, season, is_favorite } = req.body;

    if (!user_id || !name) {
      return res.status(400).json({ error: "user_id and name are required" });
    }

    const result = await query(
      `INSERT INTO outfits (user_id, name, occasion, season, is_favorite)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, name, occasion ?? null, season ?? null, is_favorite ?? false]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const { name, occasion, season, is_favorite } = req.body;

    const result = await query(
      `UPDATE outfits
       SET name = COALESCE($1, name),
           occasion = COALESCE($2, occasion),
           season = COALESCE($3, season),
           is_favorite = COALESCE($4, is_favorite),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name ?? null, occasion ?? null, season ?? null, is_favorite ?? null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Outfit not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await query("DELETE FROM outfits WHERE id = $1 RETURNING id", [
      req.params.id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Outfit not found" });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/items", async (req, res, next) => {
  try {
    const { clothing_item_id } = req.body;

    if (!clothing_item_id) {
      return res.status(400).json({ error: "clothing_item_id is required" });
    }

    const result = await query(
      `INSERT INTO outfit_items (outfit_id, clothing_item_id)
       VALUES ($1, $2)
       ON CONFLICT (outfit_id, clothing_item_id) DO NOTHING
       RETURNING outfit_id, clothing_item_id`,
      [req.params.id, clothing_item_id]
    );

    if (result.rowCount === 0) {
      return res.status(200).json({ message: "Item already in outfit" });
    }

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id/items/:itemId", async (req, res, next) => {
  try {
    const result = await query(
      "DELETE FROM outfit_items WHERE outfit_id = $1 AND clothing_item_id = $2 RETURNING outfit_id",
      [req.params.id, req.params.itemId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Outfit item relation not found" });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
