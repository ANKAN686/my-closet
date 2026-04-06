# My Closet

Project structure:

- `ui/` contains the frontend splash page UI
- `backend/` contains the Express API and PostgreSQL schemas

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp backend/.env.example backend/.env
```

3. Run database schema creation:

```bash
psql "$DATABASE_URL" -f backend/schemas/001_init.sql
```

## Run UI

```bash
npm run dev
```

## Run API Server

```bash
npm run server:dev
```

## Build UI

```bash
npm run build
```

## API Routes

- `GET /api/health`
- `GET|POST|PATCH|DELETE /api/users`
- `GET|POST|PATCH|DELETE /api/categories`
- `GET|POST|PATCH|DELETE /api/items`
- `GET|POST|PATCH|DELETE /api/outfits`
- `POST /api/outfits/:id/items`
- `DELETE /api/outfits/:id/items/:itemId`
- `GET|POST|DELETE /api/wear-logs`

## Seed Dummy Data

```bash
psql "$DATABASE_URL" -f backend/schemas/002_seed_dummy.sql
```

## UI Pages

- `/` dashboard
- `/items.html` items
- `/outfits.html` outfits
- `/wear-logs.html` wear logs
