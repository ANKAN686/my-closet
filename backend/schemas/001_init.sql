CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS clothing_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  brand TEXT,
  color TEXT,
  size TEXT,
  season TEXT,
  material TEXT,
  purchase_date DATE,
  purchase_price NUMERIC(10, 2),
  image_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outfits (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  occasion TEXT,
  season TEXT,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outfit_items (
  outfit_id BIGINT NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  clothing_item_id BIGINT NOT NULL REFERENCES clothing_items(id) ON DELETE CASCADE,
  PRIMARY KEY (outfit_id, clothing_item_id)
);

CREATE TABLE IF NOT EXISTS wear_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clothing_item_id BIGINT NOT NULL REFERENCES clothing_items(id) ON DELETE CASCADE,
  outfit_id BIGINT REFERENCES outfits(id) ON DELETE SET NULL,
  worn_on DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_clothing_items_user_id ON clothing_items(user_id);
CREATE INDEX IF NOT EXISTS idx_clothing_items_category_id ON clothing_items(category_id);
CREATE INDEX IF NOT EXISTS idx_outfits_user_id ON outfits(user_id);
CREATE INDEX IF NOT EXISTS idx_wear_logs_user_id ON wear_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_wear_logs_item_id ON wear_logs(clothing_item_id);

INSERT INTO categories (name, description)
VALUES
  ('Tops', 'Shirts, t-shirts, blouses, and sweaters'),
  ('Bottoms', 'Jeans, trousers, skirts, and shorts'),
  ('Outerwear', 'Jackets, coats, and blazers'),
  ('Footwear', 'Shoes, boots, and sandals'),
  ('Accessories', 'Belts, hats, scarves, and jewelry')
ON CONFLICT (name) DO NOTHING;
