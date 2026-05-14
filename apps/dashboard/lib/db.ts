import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../drizzle/schema.js';

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://contractqa:contractqa@localhost:5432/contractqa',
});

export const db = drizzle(pool, { schema });
