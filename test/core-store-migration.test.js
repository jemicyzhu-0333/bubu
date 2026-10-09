'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CURRENT_SCHEMA_MIGRATION_KINDS,
  persistedSchemaVersion,
  detectCurrentSchemaMigration,
  prepareCurrentSchemaMigrationBackup,
  prepareStoreMigration
} = require('../src/core/store-migration');
const { normalizePersistedState, FOOD_IDS, PERSISTED_SCHEMA_VERSION } = require('../src/platform/persistence/persisted-schema');
const { baseUrlFromEndpoint } = require('../src/capabilities/preferences');

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'im-adhder-migration-'));
  try { return run(directory); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function canonicalDuePause() {
  const state = normalizePersistedState({
    focusSession: {
      version: 1,
      status: 'paused',
      sessionId: 'legacy-held',
      taskId: 'task-1',
      plannedDurationMs: 60_000,
      elapsedBeforeStartMs: 60_000,
      activeSegments: [{ startedAt: 1_000, endedAt: 61_000 }],
      startedAt: null,
      endsAt: null,
      pausedAt: 70_000,
      pausedFrom: 'focus',
      awaitingOfflineConfirmation: true,
      recoveryReason: 'offline-session-due',
      createdAt: 1_000,
      updatedAt: 70_000
    }
  }, { now: 80_000 });
  // This compatibility detector only describes the historical schema-6
  // writer. Schema 6 now follows the normal, byte-backed-up 6 -> 7 migration
  // path before electron-store is constructed.
  state.schemaVersion = 6;
  delete state.companion;
  delete state.settings.petActivityMode;
  return state;
}

function legacyDuePause() {
  const raw = JSON.parse(JSON.stringify(canonicalDuePause()));
  delete raw.focusSession.awaitingOfflineConfirmation;
  delete raw.focusSession.recoveryReason;
  return raw;
}

test('backs up a legacy store byte-for-byte before migration can write defaults', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const source = '{\n  "tasks": [{"title": "旧任务"}],\n  "xp": 42\n}\n';
    fs.writeFileSync(storePath, source);

    const result = prepareStoreMigration(storePath, 6);

    assert.equal(result.sourceVersion, 0);
    assert.equal(result.backupCreated, true);
    assert.equal(fs.readFileSync(result.backupPath, 'utf8'), source);
    assert.deepEqual(result.raw.tasks, [{ title: '旧任务' }]);
  });
});

test('does not rewrite an existing backup and skips backup for current data', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const source = JSON.stringify({ schemaVersion: 5, xp: 7 });
    const backupPath = `${storePath}.schema-5-to-6.backup`;
    fs.writeFileSync(storePath, source);
    fs.writeFileSync(backupPath, source);
    const legacy = prepareStoreMigration(storePath, 6);
    assert.equal(legacy.backupCreated, false);
    assert.equal(fs.readFileSync(backupPath, 'utf8'), source);

    fs.writeFileSync(storePath, JSON.stringify({ schemaVersion: 6, xp: 8 }));
    const current = prepareStoreMigration(storePath, 6);
    assert.equal(current.backupPath, null);
    assert.equal(current.sourceVersion, 6);
  });
});

test('fails closed for unreadable, invalid, or future-schema data', () => {
  assert.equal(persistedSchemaVersion({}), 0);
  assert.throws(() => persistedSchemaVersion([]), /JSON object/);
  assert.throws(() => persistedSchemaVersion({ schemaVersion: 'nope' }), /invalid schemaVersion/);

  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    fs.writeFileSync(storePath, '{not-json');
    assert.throws(() => prepareStoreMigration(storePath, 6), /Cannot read I’m ADHDer data/);
    fs.writeFileSync(storePath, JSON.stringify({ schemaVersion: 7 }));
    assert.throws(() => prepareStoreMigration(storePath, 6), /newer than this app supports/);
  });
});

test('fails closed when an existing versioned backup is not the same source bytes', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    fs.writeFileSync(storePath, JSON.stringify({ schemaVersion: 5, xp: 9 }));
    fs.writeFileSync(`${storePath}.schema-5-to-6.backup`, JSON.stringify({ schemaVersion: 5, xp: 8 }));
    assert.throws(() => prepareStoreMigration(storePath, 6), /does not match/);
  });
});

test('does not proceed when the safety copy cannot be created', () => {
  const fakeFs = {
    existsSync: file => !file.endsWith('.pre-0.1.0-backup'),
    readFileSync: () => JSON.stringify({ tasks: [] }),
    copyFileSync: () => { const error = new Error('read-only volume'); error.code = 'EROFS'; throw error; }
  };
  assert.throws(
    () => prepareStoreMigration('/data/config.json', 6, { fs: fakeFs }),
    /Cannot back up I’m ADHDer data/
  );
});

test('recognizes and backs up only the exact schema-6 offline-confirmation writer shape', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const raw = legacyDuePause();
    const source = `${JSON.stringify(raw, null, 2)}\n`;
    const normalized = canonicalDuePause();
    const kind = detectCurrentSchemaMigration(raw, normalized, 6);
    assert.equal(kind, CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_OFFLINE_CONFIRMATION);

    fs.writeFileSync(storePath, source);
    const first = prepareCurrentSchemaMigrationBackup(storePath, raw, kind);
    assert.equal(first.backupCreated, true);
    assert.equal(fs.readFileSync(first.backupPath, 'utf8'), source);

    const second = prepareCurrentSchemaMigrationBackup(storePath, raw, kind);
    assert.equal(second.backupCreated, false);
    assert.equal(second.backupPath, first.backupPath);
  });
});

test('same-schema migration rejects partial markers, non-due pauses, and every unrelated drift', () => {
  const exactRaw = legacyDuePause();
  const exactNormalized = canonicalDuePause();

  const onlyAwaitingMissing = JSON.parse(JSON.stringify(canonicalDuePause()));
  delete onlyAwaitingMissing.focusSession.awaitingOfflineConfirmation;
  const nonDue = legacyDuePause();
  nonDue.focusSession.elapsedBeforeStartMs = 59_999;
  const unrelatedTopLevelDrift = legacyDuePause();
  unrelatedTopLevelDrift.xp = '0';
  const unrelatedSessionDrift = legacyDuePause();
  unrelatedSessionDrift.focusSession.unknownLegacyField = true;
  const incompleteSegments = legacyDuePause();
  incompleteSegments.focusSession.activeSegments[0].endedAt -= 1;
  const malformedSegments = legacyDuePause();
  malformedSegments.focusSession.activeSegments = [null];
  const segmentAfterPause = legacyDuePause();
  segmentAfterPause.focusSession.activeSegments[0] = { startedAt: 20_001, endedAt: 80_001 };
  const mismatchedTransitionTime = legacyDuePause();
  mismatchedTransitionTime.focusSession.updatedAt += 1;
  const incompleteCurrentStore = {
    schemaVersion: 6,
    focusSession: exactRaw.focusSession
  };

  for (const raw of [
    canonicalDuePause(),
    onlyAwaitingMissing,
    nonDue,
    unrelatedTopLevelDrift,
    unrelatedSessionDrift,
    incompleteSegments,
    malformedSegments,
    segmentAfterPause,
    mismatchedTransitionTime,
    incompleteCurrentStore
  ]) {
    assert.equal(detectCurrentSchemaMigration(raw, exactNormalized, 6), null);
  }
  assert.equal(detectCurrentSchemaMigration(exactRaw, exactNormalized, 5), null);
  assert.equal(detectCurrentSchemaMigration(exactRaw, exactNormalized, 7), null);
});

test('current-schema backup refuses an unsupported repair or changed source file', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const raw = legacyDuePause();
    fs.writeFileSync(storePath, JSON.stringify({ ...raw, xp: 1 }));

    assert.throws(
      () => prepareCurrentSchemaMigrationBackup(storePath, raw, 'anything-else'),
      /Unsupported current-schema migration/
    );
    assert.throws(
      () => prepareCurrentSchemaMigrationBackup(
        storePath,
        raw,
        CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_OFFLINE_CONFIRMATION
      ),
      /changed while preparing migration/
    );
  });
});

// ---- 纯新增的食物库存 ----
// 从 schema 6 跑一道拿到完整的 canonical 当前 schema：直接写当前版本号
// 会进入 strict 分支，要求 companion 子树已经存在。
function canonicalStore() {
  return normalizePersistedState({ schemaVersion: 6, xp: 40, level: 2 }, { now: 1_000 });
}

// 老写入器只存过前六种食物
function withLegacyFoodRoster(store) {
  const legacy = JSON.parse(JSON.stringify(store));
  const inventory = {};
  for (const foodId of ['fish', 'bone', 'donut', 'coffee', 'carrot', 'mushroom']) {
    inventory[foodId] = store.pet.foodInventory[foodId];
  }
  legacy.pet.foodInventory = inventory;
  return legacy;
}

// The pet branch kept the original schema-8 AI shape while the 0.1.2 branch
// changed it in two steps. A direct old-0.1.3 -> merged-0.1.3 upgrade therefore
// has to cross both changes in one backed-up migration.
function withLegacy013AiSettings(store, options = {}) {
  const legacy = JSON.parse(JSON.stringify(store));
  delete legacy.settings.aiModel;
  delete legacy.settings.aiBaseUrl;
  legacy.settings.aiBreakdownEnabled = options.enabled ?? legacy.settings.aiBreakdownEnabled;
  legacy.settings.aiProvider = options.provider ?? 'none';
  legacy.settings.aiEndpoint = options.endpoint ?? null;
  return legacy;
}

test('recognizes a purely additive food roster and backs it up under its own schema name', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const normalized = canonicalStore();
    const raw = withLegacyFoodRoster(normalized);
    assert.notDeepEqual(raw, normalized, 'the fixture must actually be missing the new foods');

    const kind = detectCurrentSchemaMigration(raw, normalized, PERSISTED_SCHEMA_VERSION);
    assert.equal(kind, CURRENT_SCHEMA_MIGRATION_KINDS.ADDITIVE_FOOD_ROSTER);

    const source = `${JSON.stringify(raw, null, 2)}\n`;
    fs.writeFileSync(storePath, source);
    const first = prepareCurrentSchemaMigrationBackup(storePath, raw, kind);
    assert.equal(first.backupCreated, true);
    assert.equal(
      path.basename(first.backupPath),
      `config.json.schema-${PERSISTED_SCHEMA_VERSION}-additive-food-roster.backup`
    );
    assert.equal(fs.readFileSync(first.backupPath, 'utf8'), source, 'the backup must be byte-for-byte');

    const second = prepareCurrentSchemaMigrationBackup(storePath, raw, kind);
    assert.equal(second.backupCreated, false);
    assert.equal(second.backupPath, first.backupPath);
  });
});

test('the additive food path never covers a changed count, a lost food, or drift elsewhere', () => {
  const normalized = canonicalStore();

  const changedExistingCount = withLegacyFoodRoster(normalized);
  changedExistingCount.pet.foodInventory.fish += 1;
  const lostFood = withLegacyFoodRoster(normalized);
  delete lostFood.pet.foodInventory.fish;
  const unrelatedTopLevelDrift = withLegacyFoodRoster(normalized);
  unrelatedTopLevelDrift.xp = '40';
  const unrelatedPetDrift = withLegacyFoodRoster(normalized);
  unrelatedPetDrift.pet.satiation += 1;
  const unknownPetField = withLegacyFoodRoster(normalized);
  unknownPetField.pet.unknownLegacyField = true;
  const missingInventory = withLegacyFoodRoster(normalized);
  delete missingInventory.pet.foodInventory;
  const wrongSchemaVersion = withLegacyFoodRoster(normalized);
  wrongSchemaVersion.schemaVersion = 6;

  for (const [label, raw] of Object.entries({
    changedExistingCount,
    lostFood,
    unrelatedTopLevelDrift,
    unrelatedPetDrift,
    unknownPetField,
    missingInventory,
    wrongSchemaVersion
  })) {
    assert.equal(detectCurrentSchemaMigration(raw, normalized, PERSISTED_SCHEMA_VERSION), null, label);
  }

  // 已经是今天的形状时无事可迁移；一个不在白名单里的键也不能借这条路径写入
  assert.equal(detectCurrentSchemaMigration(normalized, normalized, PERSISTED_SCHEMA_VERSION), null, 'nothing appeared');
  const junkKeyNormalized = JSON.parse(JSON.stringify(normalized));
  junkKeyNormalized.pet.foodInventory.notAFood = 0;
  const junkKeyRaw = withLegacyFoodRoster(normalized);
  assert.equal(detectCurrentSchemaMigration(junkKeyRaw, junkKeyNormalized, PERSISTED_SCHEMA_VERSION), null, 'unknown food id');
  assert.ok(!FOOD_IDS.includes('notAFood'));
});

test('the schema-6 repair keeps its original backup name after a second kind exists', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const raw = legacyDuePause();
    fs.writeFileSync(storePath, JSON.stringify(raw, null, 2));
    const backup = prepareCurrentSchemaMigrationBackup(
      storePath, raw, CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_OFFLINE_CONFIRMATION
    );
    assert.match(backup.backupPath, /\.schema-6-legacy-offline-confirmation\.backup$/);
  });
});

// ---- 旧 0.1.3 一次跨过两次 AI 设置变化 ----
test('recognizes the complete old-0.1.3 AI shape and backs it up before rewriting', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const raw = withLegacy013AiSettings(canonicalStore());
    const normalized = normalizePersistedState(raw, { now: 1_000 });
    const kind = detectCurrentSchemaMigration(raw, normalized, PERSISTED_SCHEMA_VERSION);

    assert.equal(kind, CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_AI_SETTINGS);
    const source = `${JSON.stringify(raw, null, 2)}\n`;
    fs.writeFileSync(storePath, source);
    const first = prepareCurrentSchemaMigrationBackup(storePath, raw, kind);
    assert.equal(first.backupCreated, true);
    assert.equal(
      path.basename(first.backupPath),
      `config.json.schema-${PERSISTED_SCHEMA_VERSION}-legacy-ai-settings.backup`
    );
    assert.equal(fs.readFileSync(first.backupPath, 'utf8'), source, 'the backup must be byte-for-byte');

    const second = prepareCurrentSchemaMigrationBackup(storePath, raw, kind);
    assert.equal(second.backupCreated, false);
    assert.equal(second.backupPath, first.backupPath);
  });
});

test('the old-0.1.3 AI migration preserves configuration without enabling a new network policy', () => {
  const disabled = withLegacy013AiSettings(canonicalStore(), {
    provider: 'none', enabled: true
  });
  const disabledNormalized = normalizePersistedState(disabled, { now: 1_000 });
  assert.equal(disabledNormalized.settings.aiBreakdownEnabled, false);
  assert.equal(
    detectCurrentSchemaMigration(disabled, disabledNormalized, PERSISTED_SCHEMA_VERSION),
    CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_AI_SETTINGS
  );

  for (const [provider, endpoint] of [
    ['api', null],
    ['api', 'https://api.example.test/v1/responses'],
    ['api', 'https://api.example.test/v1/responses?api-version=2026-01-01'],
    ['api', 'https:////responses/responses'],
    ['api', `https://api.example.test/${'界'.repeat(50)}/responses`],
    ['local', null],
    ['local', 'https://127.0.0.1:8443/v1/responses'],
    // The old local transport rejected this canonical HTTPS value at runtime.
    // Migration must not reinterpret it as an enabled public provider.
    ['local', 'https://public.example.test/v1/responses']
  ]) {
    const raw = withLegacy013AiSettings(canonicalStore(), { provider, endpoint, enabled: true });
    const normalized = normalizePersistedState(raw, { now: 1_000 });
    assert.equal(
      normalized.settings.aiBreakdownEnabled,
      false,
      `${provider}:${endpoint} must be explicitly re-enabled after model and endpoint review`
    );
    assert.equal(
      normalized.settings.aiBaseUrl,
      endpoint === null ? null : baseUrlFromEndpoint(endpoint),
      provider
    );
    assert.deepEqual(
      normalizePersistedState(normalized, { now: 2_000 }),
      normalized,
      `${provider}:${endpoint} must be canonical after migration`
    );
    assert.equal(
      detectCurrentSchemaMigration(raw, normalized, PERSISTED_SCHEMA_VERSION),
      CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_AI_SETTINGS,
      provider
    );
  }
});

test('the old-0.1.3 AI path rejects unsafe or non-canonical lookalikes', () => {
  const invalidProvider = withLegacy013AiSettings(canonicalStore(), { provider: 'other' });
  const invalidEndpoint = withLegacy013AiSettings(canonicalStore(), {
    provider: 'api', endpoint: 'http://api.example.test/v1/responses'
  });
  const lostExistingKey = withLegacy013AiSettings(canonicalStore());
  delete lostExistingKey.settings.workStartHour;
  const unrelatedTopLevelDrift = withLegacy013AiSettings(canonicalStore());
  unrelatedTopLevelDrift.xp = '40';

  for (const [label, raw] of Object.entries({
    invalidProvider,
    invalidEndpoint,
    lostExistingKey,
    unrelatedTopLevelDrift
  })) {
    const normalized = normalizePersistedState(raw, { now: 1_000 });
    assert.equal(
      detectCurrentSchemaMigration(raw, normalized, PERSISTED_SCHEMA_VERSION),
      null,
      label
    );
  }
});

test('partial AI-key shapes have no historical writer and fail closed', () => {
  const normalized = canonicalStore();
  const missingProvider = withLegacy013AiSettings(normalized);
  delete missingProvider.settings.aiProvider;
  const missingEndpoint = withLegacy013AiSettings(normalized);
  delete missingEndpoint.settings.aiEndpoint;
  const missingModel = JSON.parse(JSON.stringify(normalized));
  delete missingModel.settings.aiModel;
  const missingBaseUrl = JSON.parse(JSON.stringify(normalized));
  delete missingBaseUrl.settings.aiBaseUrl;
  const missingBothCurrentKeys = JSON.parse(JSON.stringify(normalized));
  delete missingBothCurrentKeys.settings.aiModel;
  delete missingBothCurrentKeys.settings.aiBaseUrl;

  for (const [label, raw] of Object.entries({
    missingProvider,
    missingEndpoint,
    missingModel,
    missingBaseUrl,
    missingBothCurrentKeys
  })) {
    const repaired = normalizePersistedState(raw, { now: 1_000 });
    assert.equal(detectCurrentSchemaMigration(raw, repaired, PERSISTED_SCHEMA_VERSION), null, label);
  }
});

// ---- 被整个删掉的 aiProvider ----
// 旧写入器还存着 aiProvider（`local` / `api`）。今天的 schema 里没有这个键，
// 所以它从文件里消失不是受损，而是那个概念退役了。
function withStoredAiProvider(store, aiProvider = 'api') {
  const legacy = JSON.parse(JSON.stringify(store));
  legacy.settings.aiProvider = aiProvider;
  return legacy;
}

test('recognizes the removed aiProvider key and backs it up under its own name', () => {
  withTempDirectory(directory => {
    const storePath = path.join(directory, 'config.json');
    const normalized = canonicalStore();
    assert.equal(
      Object.prototype.hasOwnProperty.call(normalized.settings, 'aiProvider'),
      false,
      'today 的形状里不应再有 aiProvider'
    );
    const raw = withStoredAiProvider(normalized);

    const kind = detectCurrentSchemaMigration(raw, normalized, PERSISTED_SCHEMA_VERSION);
    assert.equal(kind, CURRENT_SCHEMA_MIGRATION_KINDS.REMOVED_AI_PROVIDER);

    // 备份名必须与改名那次分得开：两次同版本修复各留一份可回溯的原文。
    const source = `${JSON.stringify(raw, null, 2)}\n`;
    fs.writeFileSync(storePath, source);
    const backup = prepareCurrentSchemaMigrationBackup(storePath, raw, kind);
    assert.equal(backup.backupCreated, true);
    assert.equal(
      path.basename(backup.backupPath),
      `config.json.schema-${PERSISTED_SCHEMA_VERSION}-removed-ai-provider.backup`
    );
    assert.equal(fs.readFileSync(backup.backupPath, 'utf8'), source, 'the backup must be byte-for-byte');
  });
});

test('dropping aiProvider never repoints a stored credential at a host the user never configured', () => {
  const normalized = canonicalStore();

  // 旧的 `local` 一档必须带 endpoint 才能构造，所以它留下的 loopback 地址会
  // 原样留在 aiBaseUrl 里，被今天的出网层拒掉、失败关闭 —— 密钥哪里也不去。
  const localWithBaseUrl = withStoredAiProvider(normalized, 'local');
  localWithBaseUrl.settings.aiBaseUrl = 'https://127.0.0.1:8443/v1';
  const carried = JSON.parse(JSON.stringify(normalized));
  carried.settings.aiBaseUrl = 'https://127.0.0.1:8443/v1';
  assert.equal(
    detectCurrentSchemaMigration(localWithBaseUrl, carried, PERSISTED_SCHEMA_VERSION),
    CURRENT_SCHEMA_MIGRATION_KINDS.REMOVED_AI_PROVIDER
  );

  // A canonical intermediate file could contain a public URL while selecting
  // local; the old runtime refused that pairing. Removing the provider must
  // disable AI instead of turning the same address into an enabled public call.
  const localWithPublicBaseUrl = withStoredAiProvider(normalized, 'local');
  localWithPublicBaseUrl.settings.aiBreakdownEnabled = true;
  localWithPublicBaseUrl.settings.aiBaseUrl = 'https://public.example.test/v1';
  const safelyDisabled = normalizePersistedState(localWithPublicBaseUrl, { now: 1_000 });
  assert.equal(safelyDisabled.settings.aiBreakdownEnabled, false);
  assert.equal(
    detectCurrentSchemaMigration(localWithPublicBaseUrl, safelyDisabled, PERSISTED_SCHEMA_VERSION),
    CURRENT_SCHEMA_MIGRATION_KINDS.REMOVED_AI_PROVIDER
  );

  // 中间写入器允许先选 local、稍后再填地址；这是合法完整形状。迁移保留空地址
  // 但关闭 AI，只有用户之后明确重开才会采用今天设置页注明的官方默认地址。
  const localWithoutBaseUrl = withStoredAiProvider(normalized, 'local');
  localWithoutBaseUrl.settings.aiBreakdownEnabled = true;
  localWithoutBaseUrl.settings.aiBaseUrl = null;
  const withoutBaseUrl = normalizePersistedState(localWithoutBaseUrl, { now: 1_000 });
  assert.equal(withoutBaseUrl.settings.aiBreakdownEnabled, false);
  assert.equal(
    detectCurrentSchemaMigration(localWithoutBaseUrl, withoutBaseUrl, PERSISTED_SCHEMA_VERSION),
    CURRENT_SCHEMA_MIGRATION_KINDS.REMOVED_AI_PROVIDER
  );
});

test('the aiProvider removal never covers a lost key, a changed value, or drift elsewhere', () => {
  const normalized = canonicalStore();

  // 一个仍在 schema 里的键消失，与 aiProvider 消失在 diff 里同形 —— 前者是受损，
  // 而且规范化会给它填回默认值，等于静默改写用户配置。
  const lostExistingKey = withStoredAiProvider(normalized);
  delete lostExistingKey.settings.workStartHour;
  const changedExistingValue = withStoredAiProvider(normalized);
  changedExistingValue.settings.aiModel = 'some-other-model';
  const unrelatedSettingsDrift = withStoredAiProvider(normalized);
  unrelatedSettingsDrift.settings.workEndHour += 1;
  const unrelatedTopLevelDrift = withStoredAiProvider(normalized);
  unrelatedTopLevelDrift.xp = '40';
  const wrongSchemaVersion = withStoredAiProvider(normalized);
  wrongSchemaVersion.schemaVersion = 7;
  // 不在表里的键不能借这条路径退役。
  const undeclaredRemoval = withStoredAiProvider(normalized);
  undeclaredRemoval.settings.someOldKey = 'x';

  for (const [label, raw] of Object.entries({
    lostExistingKey,
    changedExistingValue,
    unrelatedSettingsDrift,
    unrelatedTopLevelDrift,
    wrongSchemaVersion,
    undeclaredRemoval
  })) {
    assert.equal(detectCurrentSchemaMigration(raw, normalized, PERSISTED_SCHEMA_VERSION), null, label);
  }

  // 删键不能与新增键混在一条路径上：否则一个丢键可以拿一个新增键做掩护。
  const appearedAlongside = JSON.parse(JSON.stringify(normalized));
  delete appearedAlongside.settings.aiModel;
  assert.equal(
    detectCurrentSchemaMigration(withStoredAiProvider(appearedAlongside), normalized, PERSISTED_SCHEMA_VERSION),
    null,
    'a removal must not travel with an addition'
  );
});
