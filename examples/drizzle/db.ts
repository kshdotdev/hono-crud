/**
 * Database connection and initialization for Drizzle + PostgreSQL examples.
 *
 * Usage:
 * 1. Start PostgreSQL: cd examples && docker compose up -d
 * 2. Import and use: import { db, initDb } from './db.js';
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

// PostgreSQL connection pool
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'hono_crud',
});

// Create Drizzle instance with schema
export const db = drizzle(pool, { schema });

/**
 * Initialize the database by creating all tables.
 * This is idempotent - safe to run multiple times.
 */
export async function initDb(): Promise<void> {
  // Create enums
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE user_role AS ENUM ('admin', 'user', 'guest');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE post_status AS ENUM ('draft', 'published', 'archived');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role user_role NOT NULL DEFAULT 'user',
      age INTEGER,
      status user_status NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status post_status NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      bio TEXT,
      avatar TEXT,
      website TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content TEXT NOT NULL,
      post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  console.log('Database initialized successfully');
}

/**
 * Clear all data from tables (useful for testing).
 */
export async function clearDb(): Promise<void> {
  await pool.query('TRUNCATE comments, posts, profiles, users, categories CASCADE');
  console.log('Database cleared');
}

/**
 * Close the database connection.
 */
export async function closeDb(): Promise<void> {
  await pool.end();
}
