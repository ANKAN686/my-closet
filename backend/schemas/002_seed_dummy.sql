INSERT INTO users (email, full_name)
VALUES
  ('ava@example.com', 'Ava Stone'),
  ('liam@example.com', 'Liam Cole')
ON CONFLICT (email) DO NOTHING;

WITH ava AS (
  SELECT id FROM users WHERE email = 'ava@example.com' LIMIT 1
)
INSERT INTO clothing_items (
  user_id,
  category_id,
  name,
  brand,
  color,
  season,
  material,
  notes
)
SELECT
  ava.id,
  c.id,
  v.name,
  v.brand,
  v.color,
  v.season,
  v.material,
  v.notes
FROM ava
CROSS JOIN (
  VALUES
    ('Cotton Overshirt', 'Northline', 'Sand', 'Spring', 'Cotton', 'Light layering piece'),
    ('Wide Leg Trousers', 'Elm Studio', 'Charcoal', 'All Season', 'Wool Blend', 'Comfort fit'),
    ('Classic White Tee', 'Plain Unit', 'White', 'All Season', 'Jersey', 'Minimal staple'),
    ('Leather Chelsea Boots', 'Rooke', 'Black', 'Winter', 'Leather', 'Everyday boots')
) AS v(name, brand, color, season, material, notes)
JOIN categories c ON c.name = CASE
  WHEN v.name ILIKE '%Trousers%' THEN 'Bottoms'
  WHEN v.name ILIKE '%Boots%' THEN 'Footwear'
  ELSE 'Tops'
END
WHERE NOT EXISTS (
  SELECT 1
  FROM clothing_items i
  WHERE i.user_id = ava.id AND i.name = v.name
);

WITH ava AS (
  SELECT id FROM users WHERE email = 'ava@example.com' LIMIT 1
)
INSERT INTO outfits (user_id, name, occasion, season, is_favorite)
SELECT ava.id, x.name, x.occasion, x.season, x.favorite
FROM ava
CROSS JOIN (
  VALUES
    ('City Morning', 'Work', 'Spring', true),
    ('Weekend Coffee', 'Casual', 'All Season', false)
) AS x(name, occasion, season, favorite)
WHERE NOT EXISTS (
  SELECT 1
  FROM outfits o
  WHERE o.user_id = ava.id AND o.name = x.name
);

INSERT INTO outfit_items (outfit_id, clothing_item_id)
SELECT o.id, i.id
FROM outfits o
JOIN users u ON u.id = o.user_id
JOIN clothing_items i ON i.user_id = u.id
WHERE u.email = 'ava@example.com'
  AND (
    (o.name = 'City Morning' AND i.name IN ('Cotton Overshirt', 'Wide Leg Trousers', 'Leather Chelsea Boots'))
    OR
    (o.name = 'Weekend Coffee' AND i.name IN ('Classic White Tee', 'Wide Leg Trousers'))
  )
ON CONFLICT (outfit_id, clothing_item_id) DO NOTHING;

INSERT INTO wear_logs (user_id, clothing_item_id, outfit_id, worn_on, notes)
SELECT
  u.id,
  i.id,
  o.id,
  x.worn_on,
  x.notes
FROM (
  VALUES
    ('ava@example.com', 'City Morning', 'Cotton Overshirt', CURRENT_DATE - INTERVAL '1 day', 'Great for mild weather'),
    ('ava@example.com', 'City Morning', 'Wide Leg Trousers', CURRENT_DATE - INTERVAL '1 day', 'Comfortable fit all day'),
    ('ava@example.com', 'Weekend Coffee', 'Classic White Tee', CURRENT_DATE - INTERVAL '3 day', 'Easy weekend outfit')
) AS x(email, outfit_name, item_name, worn_on, notes)
JOIN users u ON x.email = u.email
JOIN outfits o ON o.user_id = u.id AND o.name = x.outfit_name
JOIN clothing_items i ON i.user_id = u.id AND i.name = x.item_name
WHERE NOT EXISTS (
  SELECT 1
  FROM wear_logs w
  WHERE w.user_id = u.id
    AND w.clothing_item_id = i.id
    AND w.worn_on = x.worn_on::date
);
