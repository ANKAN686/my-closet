# Database Schemas

Run this SQL file against your PostgreSQL database:

```bash
psql "$DATABASE_URL" -f backend/schemas/001_init.sql
```

Tables created:

- users
- categories
- clothing_items
- outfits
- outfit_items
- wear_logs
