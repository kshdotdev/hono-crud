/**
 * Example: Cascade Delete Operations
 *
 * Demonstrates different cascade behaviors when deleting parent records:
 * - cascade: Delete all related records
 * - setNull: Set foreign key to null
 * - restrict: Prevent delete if related records exist
 *
 * Run with: npx tsx examples/cascade-delete.ts
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { fromHono, defineModel, defineMeta } from '../../src/index.js';
import {
  MemoryCreateEndpoint,
  MemoryDeleteEndpoint,
  MemoryListEndpoint,
  clearStorage,
  getStorage,
} from '../../src/adapters/memory/index.js';

// Clear storage
clearStorage();

// ============================================================================
// Schema Definitions
// ============================================================================

const AuthorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
});

const BookSchema = z.object({
  id: z.uuid(),
  authorId: z.uuid().nullable(),
  title: z.string(),
  isbn: z.string(),
});

const ReviewSchema = z.object({
  id: z.uuid(),
  bookId: z.uuid(),
  rating: z.number().min(1).max(5),
  comment: z.string(),
});

type Author = z.infer<typeof AuthorSchema>;
type Book = z.infer<typeof BookSchema>;
type Review = z.infer<typeof ReviewSchema>;

// ============================================================================
// Model Definitions with Cascade Configuration
// ============================================================================

// Author -> Books: cascade (delete all books when author is deleted)
// Book -> Reviews: cascade (delete all reviews when book is deleted)
const AuthorModel = defineModel({
  tableName: 'authors',
  schema: AuthorSchema,
  primaryKeys: ['id'],
  relations: {
    books: {
      type: 'hasMany',
      model: 'books',
      foreignKey: 'authorId',
      cascade: {
        onDelete: 'cascade', // Delete all books when author is deleted
      },
    },
  },
});

const BookModel = defineModel({
  tableName: 'books',
  schema: BookSchema,
  primaryKeys: ['id'],
  relations: {
    reviews: {
      type: 'hasMany',
      model: 'reviews',
      foreignKey: 'bookId',
      cascade: {
        onDelete: 'cascade', // Delete all reviews when book is deleted
      },
    },
  },
});

// Alternative: Author with setNull behavior
const AuthorSetNullModel = defineModel({
  tableName: 'authors_setnull',
  schema: AuthorSchema,
  primaryKeys: ['id'],
  relations: {
    books: {
      type: 'hasMany',
      model: 'books_setnull',
      foreignKey: 'authorId',
      cascade: {
        onDelete: 'setNull', // Set authorId to null instead of deleting
      },
    },
  },
});

// Alternative: Author with restrict behavior
const AuthorRestrictModel = defineModel({
  tableName: 'authors_restrict',
  schema: AuthorSchema,
  primaryKeys: ['id'],
  relations: {
    books: {
      type: 'hasMany',
      model: 'books_restrict',
      foreignKey: 'authorId',
      cascade: {
        onDelete: 'restrict', // Prevent deletion if books exist
      },
    },
  },
});

const authorMeta = defineMeta({ model: AuthorModel });
const bookMeta = defineMeta({ model: BookModel });
const authorSetNullMeta = defineMeta({ model: AuthorSetNullModel });
const authorRestrictMeta = defineMeta({ model: AuthorRestrictModel });

// ============================================================================
// Endpoints
// ============================================================================

class AuthorCreate extends MemoryCreateEndpoint {
  _meta = authorMeta;
}

class AuthorDelete extends MemoryDeleteEndpoint {
  _meta = authorMeta;
  includeCascadeResults = true; // Show cascade results in response
}

class BookDelete extends MemoryDeleteEndpoint {
  _meta = bookMeta;
  includeCascadeResults = true;
}

class AuthorSetNullCreate extends MemoryCreateEndpoint {
  _meta = authorSetNullMeta;
}

class AuthorSetNullDelete extends MemoryDeleteEndpoint {
  _meta = authorSetNullMeta;
  includeCascadeResults = true;
}

class AuthorRestrictCreate extends MemoryCreateEndpoint {
  _meta = authorRestrictMeta;
}

class AuthorRestrictDelete extends MemoryDeleteEndpoint {
  _meta = authorRestrictMeta;
}

// ============================================================================
// App Setup
// ============================================================================

const app = fromHono(new Hono());
app.post('/authors', AuthorCreate);
app.delete('/authors/:id', AuthorDelete);
app.delete('/books/:id', BookDelete);
app.post('/authors-setnull', AuthorSetNullCreate);
app.delete('/authors-setnull/:id', AuthorSetNullDelete);
app.post('/authors-restrict', AuthorRestrictCreate);
app.delete('/authors-restrict/:id', AuthorRestrictDelete);

// ============================================================================
// Demo
// ============================================================================

async function main() {
  console.log('=== Cascade Delete Demo ===\n');

  const authorStore = getStorage<Author>('authors');
  const bookStore = getStorage<Book>('books');
  const reviewStore = getStorage<Review>('reviews');
  const authorSetNullStore = getStorage<Author>('authors_setnull');
  const bookSetNullStore = getStorage<Book>('books_setnull');
  const authorRestrictStore = getStorage<Author>('authors_restrict');
  const bookRestrictStore = getStorage<Book>('books_restrict');

  // =========================================================================
  // Demo 1: Cascade Delete
  // =========================================================================
  console.log('1. CASCADE DELETE - Delete author removes all related records\n');

  // Create author
  const authorRes = await app.request('/authors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'J.K. Rowling', email: 'jk@example.com' }),
  });
  const author = (await authorRes.json()).result;

  // Add books directly to store
  const book1: Book = {
    id: crypto.randomUUID(),
    authorId: author.id,
    title: 'Harry Potter 1',
    isbn: '978-0-7475-3269-9',
  };
  const book2: Book = {
    id: crypto.randomUUID(),
    authorId: author.id,
    title: 'Harry Potter 2',
    isbn: '978-0-7475-3849-3',
  };
  bookStore.set(book1.id, book1);
  bookStore.set(book2.id, book2);

  // Add reviews for first book
  const review1: Review = {
    id: crypto.randomUUID(),
    bookId: book1.id,
    rating: 5,
    comment: 'Amazing!',
  };
  const review2: Review = {
    id: crypto.randomUUID(),
    bookId: book1.id,
    rating: 4,
    comment: 'Great read!',
  };
  reviewStore.set(review1.id, review1);
  reviewStore.set(review2.id, review2);

  console.log('   Before delete:');
  console.log(`   - Authors: ${authorStore.size}`);
  console.log(`   - Books: ${bookStore.size}`);
  console.log(`   - Reviews: ${reviewStore.size}`);

  // Delete author - cascades to books
  const deleteRes = await app.request(`/authors/${author.id}`, { method: 'DELETE' });
  const deleteResult = await deleteRes.json();

  console.log('\n   After deleting author:');
  console.log(`   - Authors: ${authorStore.size}`);
  console.log(`   - Books: ${bookStore.size}`);
  console.log(`   - Reviews: ${reviewStore.size} (reviews NOT deleted - no cascade from author)`);
  console.log(`   - Cascade result: ${JSON.stringify(deleteResult.result.cascade)}`);
  console.log();

  // =========================================================================
  // Demo 2: Nested Cascade (Book -> Reviews)
  // =========================================================================
  console.log('2. NESTED CASCADE - Delete book removes all reviews\n');

  // Create new data
  const book3: Book = {
    id: crypto.randomUUID(),
    authorId: null,
    title: 'Standalone Book',
    isbn: '000-0-0000-0000-0',
  };
  bookStore.set(book3.id, book3);

  const review3: Review = {
    id: crypto.randomUUID(),
    bookId: book3.id,
    rating: 3,
    comment: 'It was okay',
  };
  reviewStore.set(review3.id, review3);

  console.log('   Before delete:');
  console.log(`   - Books: ${bookStore.size}`);
  console.log(`   - Reviews: ${reviewStore.size}`);

  // Delete book - cascades to reviews
  const bookDeleteRes = await app.request(`/books/${book3.id}`, { method: 'DELETE' });
  const bookDeleteResult = await bookDeleteRes.json();

  console.log('\n   After deleting book:');
  console.log(`   - Books: ${bookStore.size}`);
  console.log(`   - Reviews: ${reviewStore.size}`);
  console.log(`   - Cascade result: ${JSON.stringify(bookDeleteResult.result.cascade)}`);
  console.log();

  // =========================================================================
  // Demo 3: SetNull Cascade
  // =========================================================================
  console.log('3. SET NULL - Delete author sets book.authorId to null\n');

  // Create author with setNull behavior
  const author2Res = await app.request('/authors-setnull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'George Orwell', email: 'george@example.com' }),
  });
  const author2 = (await author2Res.json()).result;

  // Add books
  const book4: Book = {
    id: crypto.randomUUID(),
    authorId: author2.id,
    title: '1984',
    isbn: '978-0-452-28423-4',
  };
  const book5: Book = {
    id: crypto.randomUUID(),
    authorId: author2.id,
    title: 'Animal Farm',
    isbn: '978-0-452-28424-1',
  };
  bookSetNullStore.set(book4.id, book4);
  bookSetNullStore.set(book5.id, book5);

  console.log('   Before delete:');
  console.log(`   - Authors: ${authorSetNullStore.size}`);
  console.log(`   - Books: ${bookSetNullStore.size}`);
  console.log(`   - Book authorIds: ${[...bookSetNullStore.values()].map(b => b.authorId).join(', ')}`);

  // Delete author - sets authorId to null
  const deleteRes2 = await app.request(`/authors-setnull/${author2.id}`, { method: 'DELETE' });
  const deleteResult2 = await deleteRes2.json();

  console.log('\n   After deleting author:');
  console.log(`   - Authors: ${authorSetNullStore.size}`);
  console.log(`   - Books: ${bookSetNullStore.size} (books preserved!)`);
  console.log(`   - Book authorIds: ${[...bookSetNullStore.values()].map(b => b.authorId).join(', ')}`);
  console.log(`   - Cascade result: ${JSON.stringify(deleteResult2.result.cascade)}`);
  console.log();

  // =========================================================================
  // Demo 4: Restrict Cascade
  // =========================================================================
  console.log('4. RESTRICT - Cannot delete author if books exist\n');

  // Create author with restrict behavior
  const author3Res = await app.request('/authors-restrict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Stephen King', email: 'stephen@example.com' }),
  });
  const author3 = (await author3Res.json()).result;

  // Add a book
  const book6: Book = {
    id: crypto.randomUUID(),
    authorId: author3.id,
    title: 'The Shining',
    isbn: '978-0-385-12167-5',
  };
  bookRestrictStore.set(book6.id, book6);

  console.log('   Before delete attempt:');
  console.log(`   - Authors: ${authorRestrictStore.size}`);
  console.log(`   - Books: ${bookRestrictStore.size}`);

  // Try to delete author - should fail
  const deleteRes3 = await app.request(`/authors-restrict/${author3.id}`, { method: 'DELETE' });
  const deleteResult3 = await deleteRes3.json();

  console.log('\n   After delete attempt:');
  console.log(`   - Status: ${deleteRes3.status}`);
  console.log(`   - Authors: ${authorRestrictStore.size} (not deleted!)`);
  console.log(`   - Books: ${bookRestrictStore.size}`);
  console.log(`   - Error: ${deleteResult3.error?.message}`);
  console.log();

  console.log('=== Demo Complete ===');
}

main().catch(console.error);
