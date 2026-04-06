import express from "express";

import { query } from "../db.js";

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { user_id, category_id, search } = req.query;
    const filters = [];
    const values = [];

    if (user_id) {
      values.push(user_id);
      filters.push(`i.user_id = $${values.length}`);
    }

    if (category_id) {
      values.push(category_id);
      filters.push(`i.category_id = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(i.name ILIKE $${values.length} OR i.brand ILIKE $${values.length})`);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    const sql = `
      SELECT
        i.id,
        i.user_id,
        i.category_id,
        c.name AS category_name,
        i.name,
        i.brand,
        i.color,
        i.size,
        i.season,
        i.material,
        i.purchase_date,
        i.purchase_price,
        i.image_url,
        i.notes,
        i.created_at,
        i.updated_at
      FROM clothing_items i
      LEFT JOIN categories c ON c.id = i.category_id
      ${whereClause}
      ORDER BY i.created_at DESC
    `;

    const result = await query(sql, values);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
        i.id,
        i.user_id,
        i.category_id,
        c.name AS category_name,
        i.name,
        i.brand,
        i.color,
        i.size,
        i.season,
        i.material,
        i.purchase_date,
        i.purchase_price,
        i.image_url,
        i.notes,
        i.created_at,
        i.updated_at
       FROM clothing_items i
       LEFT JOIN categories c ON c.id = i.category_id
       WHERE i.id = $1`,
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      user_id,
      category_id,
      name,
      brand,
      color,
      size,
      season,
      material,
      purchase_date,
      purchase_price,
      image_url,
      notes,
    } = req.body;

    if (!user_id || !name) {
      return res.status(400).json({ error: "user_id and name are required" });
    }

    const result = await query(
      `INSERT INTO clothing_items
        (user_id, category_id, name, brand, color, size, season, material, purchase_date, purchase_price, image_url, notes)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        user_id,
        category_id ?? null,
        name,
        brand ?? null,
        color ?? null,
        size ?? null,
        season ?? null,
        material ?? null,
        purchase_date ?? null,
        purchase_price ?? null,
        image_url ?? null,
        notes ?? null,
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const {
      category_id,
      name,
      brand,
      color,
      size,
      season,
      material,
      purchase_date,
      purchase_price,
      image_url,
      notes,
    } = req.body;

    const result = await query(
      `UPDATE clothing_items
       SET category_id = COALESCE($1, category_id),
           name = COALESCE($2, name),
           brand = COALESCE($3, brand),
           color = COALESCE($4, color),
           size = COALESCE($5, size),
           season = COALESCE($6, season),
           material = COALESCE($7, material),
           purchase_date = COALESCE($8, purchase_date),
           purchase_price = COALESCE($9, purchase_price),
           image_url = COALESCE($10, image_url),
           notes = COALESCE($11, notes),
           updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        category_id ?? null,
        name ?? null,
        brand ?? null,
        color ?? null,
        size ?? null,
        season ?? null,
        material ?? null,
        purchase_date ?? null,
        purchase_price ?? null,
        image_url ?? null,
        notes ?? null,
        req.params.id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await query(
      "DELETE FROM clothing_items WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Item not found" });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
