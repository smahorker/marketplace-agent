import pg from "pg";
import { attachDatabasePool } from "@neon/functions";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

export const USER_ID = "demo";

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}
