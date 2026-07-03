import { createMemoryCrud } from '@hono-crud/memory';
import { defineMeta, defineModel } from 'hono-crud';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const WidgetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: z.enum(['active', 'inactive']).default('active'),
});

// Lowercase tableName, NO explicit `tag` — factory should derive the tag from
// `tableName`.
const WidgetModel = defineModel({
  tableName: 'widgets',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});
const widgetMeta = defineMeta({ model: WidgetModel });

// Same shape but WITH a capitalized display `tag` — factory should derive the
// tag from `tag`, not `tableName`.
const AccountModel = defineModel({
  tableName: 'accounts',
  tag: 'Accounts',
  schema: WidgetSchema,
  primaryKeys: ['id'],
});
const accountMeta = defineMeta({ model: AccountModel });

describe('createMemoryCrud tag defaulting', () => {
  const Widget = createMemoryCrud(widgetMeta);

  it('defaults schema.tags from the model tableName when no tag is set on the endpoint', () => {
    class WidgetCreate extends Widget.Create {}

    const schema = new WidgetCreate().getSchema();
    expect(schema.tags).toEqual(['widgets']);
  });

  it('defaults schema.tags from the model `tag` when the model provides one', () => {
    const Account = createMemoryCrud(accountMeta);
    class AccountCreate extends Account.Create {}

    const schema = new AccountCreate().getSchema();
    expect(schema.tags).toEqual(['Accounts']);
  });

  it('preserves non-tag schema fields while filling the default tag', () => {
    class WidgetList extends Widget.List {
      schema = { summary: 'List widgets' };
      filterFields = ['status'];
    }

    const schema = new WidgetList().getSchema();
    expect(schema.tags).toEqual(['widgets']);
    expect(schema.summary).toBe('List widgets');
  });

  it('lets an explicit non-empty schema.tags win over the model-derived default', () => {
    class WidgetRead extends Widget.Read {
      schema = { tags: ['Custom Widgets'], summary: 'Read a widget' };
    }

    const schema = new WidgetRead().getSchema();
    expect(schema.tags).toEqual(['Custom Widgets']);
    expect(schema.summary).toBe('Read a widget');
  });

  it('stamps _meta on the configured base classes so subclasses need not restate it', () => {
    class WidgetCreate extends Widget.Create {}

    expect(new WidgetCreate()._meta).toBe(widgetMeta);
  });
});
