/**
 * Database connection and initialization for Prisma + PostgreSQL examples.
 *
 * Usage:
 * 1. Start PostgreSQL: cd examples && docker compose up -d
 * 2. Generate client: npx prisma generate --schema=examples/prisma/schema.prisma
 * 3. Push schema: npx prisma db push --schema=examples/prisma/schema.prisma
 * 4. Import and use: import { prisma, initDb } from './db.js';
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Database connection URL
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/hono_crud?schema=public';

// Create Prisma adapter with connection string (Prisma 7 pattern)
const adapter = new PrismaPg({ connectionString: DATABASE_URL });

// Create Prisma client with adapter
export const prisma = new PrismaClient({
  adapter,
  log: process.env.DEBUG ? ['query', 'info', 'warn', 'error'] : ['error'],
});

/**
 * Initialize the database connection.
 * Call this before starting the server.
 */
export async function initDb(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('Database connected successfully');
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
}

/**
 * Clear all data from tables (useful for testing).
 * Truncates in the correct order to respect foreign key constraints.
 */
export async function clearDb(): Promise<void> {
  // Delete in reverse order of dependencies
  await prisma.comment.deleteMany();
  await prisma.post.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.category.deleteMany();
  console.log('Database cleared');
}

/**
 * Close the database connection.
 */
export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Seed sample data for testing.
 */
export async function seedDb(): Promise<void> {
  // Clear existing data first
  await clearDb();

  // Seed users
  await prisma.user.createMany({
    data: [
      { id: 'a0000000-0000-0000-0000-000000000001', email: 'alice@example.com', name: 'Alice Admin', role: 'admin', age: 35, status: 'active' },
      { id: 'a0000000-0000-0000-0000-000000000002', email: 'bob@example.com', name: 'Bob User', role: 'user', age: 28, status: 'active' },
      { id: 'a0000000-0000-0000-0000-000000000003', email: 'charlie@example.com', name: 'Charlie Guest', role: 'guest', age: 22, status: 'pending' },
    ],
  });

  // Seed profiles
  await prisma.profile.createMany({
    data: [
      { id: 'b0000000-0000-0000-0000-000000000001', userId: 'a0000000-0000-0000-0000-000000000001', bio: 'Alice is a developer', avatar: 'https://example.com/alice.jpg' },
      { id: 'b0000000-0000-0000-0000-000000000002', userId: 'a0000000-0000-0000-0000-000000000002', bio: 'Bob is a designer' },
    ],
  });

  // Seed posts
  await prisma.post.createMany({
    data: [
      { id: 'c0000000-0000-0000-0000-000000000001', title: 'Hello World', content: 'This is my first post!', authorId: 'a0000000-0000-0000-0000-000000000001', status: 'published' },
      { id: 'c0000000-0000-0000-0000-000000000002', title: 'Design Tips', content: 'Here are some design tips...', authorId: 'a0000000-0000-0000-0000-000000000002', status: 'draft' },
    ],
  });

  // Seed comments
  await prisma.comment.createMany({
    data: [
      { id: 'd0000000-0000-0000-0000-000000000001', content: 'Great post!', postId: 'c0000000-0000-0000-0000-000000000001', authorId: 'a0000000-0000-0000-0000-000000000002' },
      { id: 'd0000000-0000-0000-0000-000000000002', content: 'Thanks for sharing!', postId: 'c0000000-0000-0000-0000-000000000001', authorId: 'a0000000-0000-0000-0000-000000000001' },
    ],
  });

  // Seed categories
  await prisma.category.createMany({
    data: [
      { name: 'Technology', description: 'Tech related posts', sortOrder: 1 },
      { name: 'Science', description: 'Scientific articles', sortOrder: 2 },
      { name: 'Art', sortOrder: 3 },
    ],
  });

  console.log('Database seeded: 3 users, 2 profiles, 2 posts, 2 comments, 3 categories');
}
