'use strict';

const { COLLABORATION_USER_VERSION, MIGRATIONS } = require('./collaboration-migrations');
const { createConversationRepository } = require('./conversation-repository');
const { validateConversationSnapshot } = require('../../../application/ai/conversation-record');

function verifySchema(handle, ownerId) {
  const version = handle.userVersion();
  if (version < 1 || version > COLLABORATION_USER_VERSION) throw new Error('collaboration-schema-invalid');
  const expected = {
    collaboration_identity: ['singleton', 'owner_id'],
    conversations: ['id', 'owner_id', 'revision', 'created_at', 'updated_at', 'expires_at', 'snapshot']
  };
  if (version >= 4) expected.collaboration_durability = ['singleton', 'verification_count'];
  const names = [...Object.keys(expected), 'conversations_owner_updated', 'conversations_retention'];
  const objects = handle.all("SELECT name, type, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
  if (objects.length !== names.length || objects.some(item => !names.includes(item.name))
    || objects.some(item => !['table', 'index'].includes(item.type))) throw new Error('collaboration-schema-invalid');
  const definitions = new Set(MIGRATIONS.filter(migration => migration.version <= version).flatMap(migration => migration.statements).map(sql => sql.replace(/\s+/g, ' ').trim()));
  if (objects.some(object => !definitions.has(object.sql.replace(/\s+/g, ' ').trim()))) throw new Error('collaboration-schema-invalid');
  for (const [table, columns] of Object.entries(expected)) {
    if (JSON.stringify(handle.all(`PRAGMA table_info(${table})`).map(column => column.name)) !== JSON.stringify(columns)) {
      throw new Error('collaboration-schema-invalid');
    }
  }
  const identities = handle.all('SELECT singleton, owner_id FROM collaboration_identity');
  if (identities.length !== 1 || identities[0].singleton !== 1) throw new Error('collaboration-schema-invalid');
  if (identities[0].owner_id !== ownerId) throw new Error('collaboration-owner-mismatch');
  if (handle.all('PRAGMA foreign_key_check').length) throw new Error('collaboration-schema-invalid');
  const repository = createConversationRepository({ handle, ownerId });
  for (const row of handle.all('SELECT id FROM conversations')) {
    const loaded = repository.load({ ownerId, conversationId: row.id });
    if (!loaded.ok || !validateConversationSnapshot(loaded.conversation)) throw new Error('collaboration-record-invalid');
  }
  if (version >= 4) {
    const rows = handle.all('SELECT singleton, verification_count FROM collaboration_durability');
    if (rows.length !== 1 || rows[0].singleton !== 1 || !Number.isSafeInteger(rows[0].verification_count)
      || rows[0].verification_count < 0) throw new Error('collaboration-schema-invalid');
  }
  return repository;
}

module.exports = { verifySchema };
