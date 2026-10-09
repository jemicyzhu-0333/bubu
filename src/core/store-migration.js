'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { FOOD_IDS } = require('../platform/persistence/persisted-schema');
const { DEFAULT_SETTINGS, MAX_AI_URL_INPUT_LENGTH, baseUrlFromEndpoint, isHttpsEndpoint } = require('../capabilities/preferences');

const CURRENT_SCHEMA_MIGRATION_KINDS = Object.freeze({
  LEGACY_OFFLINE_CONFIRMATION: 'legacy-offline-confirmation',
  ADDITIVE_FOOD_ROSTER: 'additive-food-roster',
  LEGACY_AI_SETTINGS: 'legacy-ai-settings',
  REMOVED_AI_PROVIDER: 'removed-ai-provider',
  UPDATE_CHECK_SETTING: 'update-check-setting'
});

// 备份文件名带上文件自己的 schema 号，既能区分两次同版本修复，
// 也保证已经存在的 schema-6 / schema-7 备份名不变。
const SUPPORTED_MIGRATION_KINDS = Object.freeze(Object.values(CURRENT_SCHEMA_MIGRATION_KINDS));

// 第一版食物库存写入器只存过这六种。只有晚于它加入的食物才允许在
// 这条路径上出现；这六种里任何一个缺失都可能是数据受损，而规范化会给
// 它填上非零的默认值，等于白送库存，所以必须失败关闭。
const ORIGINAL_FOOD_IDS = Object.freeze([
  'fish', 'bone', 'donut', 'coffee', 'carrot', 'mushroom'
]);

// 被整个删掉的设置键：不是改名，也没有继任者，而是背后的概念没了。
// `aiProvider` 曾经描述“连接形态”（`local` / `api`）；现在“连哪儿”完全由
// `aiBaseUrl` 决定，“说哪种协议”是运行时探出来的，那个模式开关因此不再
// 存在。这与“一个键从文件里丢了”在 diff 里同形，但区别是决定性的：今天的
// schema 里已经没有这个键，所以不存在一个默认值能把它悄悄“修好”。仍然写成
// 一张显式的表：“任何键消失都放过”就等于把一份丢键的损坏文件当成正常升级。
const REMOVED_SETTINGS_KEYS = Object.freeze(['aiProvider']);
const LEGACY_AI_PROVIDERS = Object.freeze(['none', 'local', 'api']);
const POST_RENAME_AI_PROVIDERS = Object.freeze(['local', 'api']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function persistedSchemaVersion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('I’m ADHDer data file must contain a JSON object');
  }
  if (raw.schemaVersion === undefined || raw.schemaVersion === null) return 0;
  const version = Number(raw.schemaVersion);
  if (!Number.isInteger(version) || version < 0) {
    throw new RangeError('I’m ADHDer data file has an invalid schemaVersion');
  }
  return version;
}

/**
 * Schema 6 briefly shipped a canonical paused-at-deadline session before its
 * writer persisted the two explicit offline-confirmation fields. Remove exactly
 * those two inferred fields from today's normalized result and every remaining
 * persisted value must already match the source object.
 */
function detectLegacyOfflineConfirmation(raw, normalized, targetVersion) {
  if (targetVersion !== 6) return null;
  if (raw.schemaVersion !== targetVersion || normalized.schemaVersion !== targetVersion) return null;
  const rawSession = raw.focusSession;
  const normalizedSession = normalized.focusSession;
  if (!isPlainObject(rawSession) || !isPlainObject(normalizedSession)) return null;
  if (Object.prototype.hasOwnProperty.call(rawSession, 'awaitingOfflineConfirmation')
      || Object.prototype.hasOwnProperty.call(rawSession, 'recoveryReason')) return null;
  if (rawSession.status !== 'paused'
      || !Number.isFinite(rawSession.plannedDurationMs)
      || rawSession.plannedDurationMs <= 0
      || rawSession.elapsedBeforeStartMs !== rawSession.plannedDurationMs
      || rawSession.pausedAt !== rawSession.updatedAt) return null;
  const segments = Array.isArray(rawSession.activeSegments) ? rawSession.activeSegments : [];
  if (!segments.every(segment => (
    isPlainObject(segment)
    && Number.isFinite(segment.startedAt)
    && Number.isFinite(segment.endedAt)
    && segment.endedAt > segment.startedAt
  ))) return null;
  const recordedActiveMs = segments.reduce((total, segment) => (
    total + (segment.endedAt - segment.startedAt)
  ), 0);
  if (recordedActiveMs !== rawSession.plannedDurationMs
      || segments.some(segment => segment.endedAt > rawSession.pausedAt)) return null;
  if (normalizedSession.status !== 'paused'
      || normalizedSession.awaitingOfflineConfirmation !== true
      || normalizedSession.recoveryReason !== 'offline-session-due') return null;

  const legacyProjection = {
    ...normalized,
    focusSession: { ...normalizedSession }
  };
  delete legacyProjection.focusSession.awaitingOfflineConfirmation;
  delete legacyProjection.focusSession.recoveryReason;
  return isDeepStrictEqual(raw, legacyProjection)
    ? CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_OFFLINE_CONFIRMATION
    : null;
}

/**
 * A roster that only ever grows is the one same-schema difference we can prove
 * benign, so this check is deliberately not pinned to a single schema version:
 * adding a food without a schema bump is a thing every future release can do.
 * Delete exactly the newly appeared food keys from today's normalized result;
 * every remaining persisted value must already match the source object. A count
 * that changed, one of the six original foods gone missing, or any drift outside
 * the inventory therefore still fails closed.
 */
function detectAdditiveFoodRoster(raw, normalized, targetVersion) {
  if (raw.schemaVersion !== targetVersion || normalized.schemaVersion !== targetVersion) return null;
  const rawPet = raw.pet;
  const normalizedPet = normalized.pet;
  if (!isPlainObject(rawPet) || !isPlainObject(normalizedPet)) return null;
  const rawInventory = rawPet.foodInventory;
  const normalizedInventory = normalizedPet.foodInventory;
  if (!isPlainObject(rawInventory) || !isPlainObject(normalizedInventory)) return null;

  const appeared = Object.keys(normalizedInventory).filter(
    foodId => !Object.prototype.hasOwnProperty.call(rawInventory, foodId)
  );
  if (appeared.length === 0) return null;
  // 只接受已知食物 id，不能拿这条路径把任意新键洗进库存。
  if (!appeared.every(foodId => FOOD_IDS.includes(foodId))) return null;
  // 原有的六种不能靠“新增”重新出现，否则一个丢键的损坏文件会被默认值“修好”。
  if (appeared.some(foodId => ORIGINAL_FOOD_IDS.includes(foodId))) return null;

  const legacyInventory = { ...normalizedInventory };
  for (const foodId of appeared) delete legacyInventory[foodId];
  const legacyProjection = {
    ...normalized,
    pet: { ...normalizedPet, foodInventory: legacyInventory }
  };
  return isDeepStrictEqual(raw, legacyProjection)
    ? CURRENT_SCHEMA_MIGRATION_KINDS.ADDITIVE_FOOD_ROSTER
    : null;
}

/**
 * The 0.1.3 branch and the complete 0.1.2 branch both wrote schema 8, but they
 * did not write the same AI settings shape. A direct merge upgrade therefore
 * crosses the rename and provider removal in one launch instead of seeing the
 * two historical fixes one at a time. Recognize that exact old writer shape as
 * one migration; composing the permissive parts of two detectors would also
 * let unrelated missing keys hide beside each other.
 */
function detectLegacyAiSettings(raw, normalized, targetVersion) {
  if (raw.schemaVersion !== targetVersion || normalized.schemaVersion !== targetVersion) return null;
  const rawSettings = raw.settings;
  const normalizedSettings = normalized.settings;
  if (!isPlainObject(rawSettings) || !isPlainObject(normalizedSettings)) return null;

  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  if (!has(rawSettings, 'aiProvider') || !has(rawSettings, 'aiEndpoint')) return null;
  if (has(rawSettings, 'aiModel') || has(rawSettings, 'aiBaseUrl')) return null;
  if (has(normalizedSettings, 'aiProvider') || has(normalizedSettings, 'aiEndpoint')) return null;
  if (!has(normalizedSettings, 'aiModel') || !has(normalizedSettings, 'aiBaseUrl')) return null;

  const provider = rawSettings.aiProvider;
  const endpoint = rawSettings.aiEndpoint;
  if (!LEGACY_AI_PROVIDERS.includes(provider)) return null;
  if (typeof rawSettings.aiBreakdownEnabled !== 'boolean') return null;
  if (endpoint !== null && (
    typeof endpoint !== 'string'
    || endpoint !== endpoint.trim()
    || !isHttpsEndpoint(endpoint, MAX_AI_URL_INPUT_LENGTH)
  )) return null;
  const expectedBaseUrl = endpoint === null ? null : baseUrlFromEndpoint(endpoint);
  // URL canonicalization can expand a short Unicode/control-character input.
  // Refuse to write a derived value that today's validator would reject at the
  // very next startup; the original file remains untouched for manual review.
  if (expectedBaseUrl !== null && !isHttpsEndpoint(expectedBaseUrl)) return null;
  if (normalizedSettings.aiBaseUrl !== expectedBaseUrl) return null;
  if (normalizedSettings.aiModel !== DEFAULT_SETTINGS.aiModel) return null;
  // The old writer did not persist its selected model, and `local` also promised
  // a transport policy that no longer exists. No legacy provider may become an
  // active public client merely because an encrypted credential is present.
  if (normalizedSettings.aiBreakdownEnabled !== false) return null;

  const legacySettings = { ...normalizedSettings };
  delete legacySettings.aiModel;
  delete legacySettings.aiBaseUrl;
  legacySettings.aiProvider = provider;
  legacySettings.aiEndpoint = endpoint;
  legacySettings.aiBreakdownEnabled = rawSettings.aiBreakdownEnabled;
  const legacyProjection = { ...normalized, settings: legacySettings };
  return isDeepStrictEqual(raw, legacyProjection)
    ? CURRENT_SCHEMA_MIGRATION_KINDS.LEGACY_AI_SETTINGS
    : null;
}

/**
 * A settings key whose concept was removed outright is the fourth same-schema
 * difference we can prove benign: today's shape simply has no such key, so no
 * default value can quietly reconstruct it. Only the keys named above may
 * disappear, nothing may appear on this path, and everything else in the file
 * must already match, so unrelated drift still fails closed.
 */
function detectRemovedAiProvider(raw, normalized, targetVersion) {
  if (raw.schemaVersion !== targetVersion || normalized.schemaVersion !== targetVersion) return null;
  const rawSettings = raw.settings;
  const normalizedSettings = normalized.settings;
  if (!isPlainObject(rawSettings) || !isPlainObject(normalizedSettings)) return null;

  const removed = Object.keys(rawSettings).filter(
    key => !Object.prototype.hasOwnProperty.call(normalizedSettings, key)
  );
  if (removed.length === 0) return null;
  if (!removed.every(key => REMOVED_SETTINGS_KEYS.includes(key))) return null;
  if (!POST_RENAME_AI_PROVIDERS.includes(rawSettings.aiProvider)) return null;
  // 这一次只删不加。新增键与删除混在一起时只有上面那个完整旧
  // writer 形状可以通过：否则一个丢键可以拿另一个新增键做掩护。
  if (Object.keys(normalizedSettings).some(
    key => !Object.prototype.hasOwnProperty.call(rawSettings, key)
  )) return null;
  // `local` 不论有没有地址都先关闭 AI，因为旧运行时承诺 loopback-only，
  // 而今天只有公网 client；迁移只保存配置，不能让旧选择突然出网。
  if (rawSettings.aiProvider === 'local') {
    if (typeof rawSettings.aiBreakdownEnabled !== 'boolean') return null;
    if (normalizedSettings.aiBreakdownEnabled !== false) return null;
  }

  const legacySettings = { ...normalizedSettings };
  for (const key of removed) legacySettings[key] = rawSettings[key];
  if (rawSettings.aiProvider === 'local') {
    legacySettings.aiBreakdownEnabled = rawSettings.aiBreakdownEnabled;
  }
  const legacyProjection = { ...normalized, settings: legacySettings };
  return isDeepStrictEqual(raw, legacyProjection)
    ? CURRENT_SCHEMA_MIGRATION_KINDS.REMOVED_AI_PROVIDER
    : null;
}

// A known prior writer lacks only this additive setting. Any other normalized
// difference remains an error, and the adapter must back up before applying it.
function detectUpdateCheckSetting(raw, normalized, targetVersion) {
  if (targetVersion !== 17 || raw.schemaVersion !== targetVersion || normalized.schemaVersion !== targetVersion
      || !isPlainObject(raw.settings) || !isPlainObject(normalized.settings)
      || Object.hasOwn(raw.settings, 'autoCheckUpdates') || normalized.settings.autoCheckUpdates !== true) return null;
  const previousSettings = { ...normalized.settings };
  delete previousSettings.autoCheckUpdates;
  return isDeepStrictEqual(raw, { ...normalized, settings: previousSettings })
    ? CURRENT_SCHEMA_MIGRATION_KINDS.UPDATE_CHECK_SETTING : null;
}

/**
 * The only same-schema migrations we accept. Each one must reconstruct the
 * older writer's exact shape from today's normalized result, so an unrecognized
 * difference always fails closed instead of silently rewriting user data.
 */
function detectCurrentSchemaMigration(raw, normalized, targetVersion) {
  if (!isPlainObject(raw) || !isPlainObject(normalized)) return null;
  return detectUpdateCheckSetting(raw, normalized, targetVersion)
    || detectLegacyOfflineConfirmation(raw, normalized, targetVersion)
    || detectAdditiveFoodRoster(raw, normalized, targetVersion)
    || detectLegacyAiSettings(raw, normalized, targetVersion)
    || detectRemovedAiProvider(raw, normalized, targetVersion);
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function createVerifiedBackup(storePath, backupPath, sourceBytes, fileSystem) {
  const expectedBytes = asBuffer(sourceBytes);
  let backupCreated = false;
  if (!fileSystem.existsSync(backupPath)) {
    try {
      fileSystem.copyFileSync(storePath, backupPath, fs.constants.COPYFILE_EXCL);
      backupCreated = true;
    } catch (error) {
      // A racing process may have completed the same exclusive copy. Any
      // other failure must stop migration so the only original is untouched.
      if (error.code !== 'EEXIST') {
        throw new Error(`Cannot back up I’m ADHDer data before migration: ${error.message}`, { cause: error });
      }
    }
  }

  let backupBytes;
  try {
    backupBytes = asBuffer(fileSystem.readFileSync(backupPath));
  } catch (error) {
    throw new Error(`Cannot verify I’m ADHDer migration backup: ${error.message}`, { cause: error });
  }
  if (!backupBytes.equals(expectedBytes)) {
    throw new Error('I’m ADHDer migration backup does not match the current source data; refusing to overwrite either file');
  }
  return { backupPath, backupCreated };
}

function prepareCurrentSchemaMigrationBackup(storePath, expectedRaw, migrationKind, options = {}) {
  if (!SUPPORTED_MIGRATION_KINDS.includes(migrationKind)) {
    throw new RangeError('Unsupported current-schema migration');
  }
  const fileSystem = options.fs || fs;
  let sourceBytes;
  let diskRaw;
  try {
    sourceBytes = asBuffer(fileSystem.readFileSync(storePath));
    diskRaw = JSON.parse(sourceBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Cannot read I’m ADHDer data before migration: ${error.message}`, { cause: error });
  }
  if (!isDeepStrictEqual(diskRaw, expectedRaw)) {
    throw new Error('I’m ADHDer data changed while preparing migration; refusing to overwrite it');
  }
  // 版本号来自文件自身，而不是一张按修复种类写死的表：这样每种修复在任何
  // schema 上都落在自己的名字下，已经存在的备份名也不会被改写。
  const migrationVersion = persistedSchemaVersion(diskRaw);
  const backupPath = `${storePath}.schema-${migrationVersion}-${migrationKind}.backup`;
  return createVerifiedBackup(storePath, backupPath, sourceBytes, fileSystem);
}

/**
 * Read and, when needed, back up the persisted store before electron-store is
 * constructed. Conf applies and writes defaults in its constructor, so doing
 * this afterwards can no longer distinguish a legacy file from a fresh one.
 */
function prepareStoreMigration(storePath, targetVersion, options = {}) {
  const fileSystem = options.fs || fs;
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new RangeError('targetVersion must be a positive integer');
  }
  if (!fileSystem.existsSync(storePath)) {
    return { exists: false, raw: {}, sourceVersion: 0, backupPath: null, backupCreated: false };
  }

  let raw;
  let sourceBytes;
  try {
    sourceBytes = asBuffer(fileSystem.readFileSync(storePath));
    raw = JSON.parse(sourceBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Cannot read I’m ADHDer data before migration: ${error.message}`, { cause: error });
  }

  const sourceVersion = persistedSchemaVersion(raw);
  if (sourceVersion > targetVersion) {
    throw new Error(`I’m ADHDer data schema ${sourceVersion} is newer than this app supports (${targetVersion})`);
  }
  if (sourceVersion === targetVersion) {
    return { exists: true, raw, sourceVersion, backupPath: null, backupCreated: false };
  }

  const backupPath = sourceVersion === 0
    ? `${storePath}.pre-0.1.0-backup`
    : `${storePath}.schema-${sourceVersion}-to-${targetVersion}.backup`;
  const backup = createVerifiedBackup(storePath, backupPath, sourceBytes, fileSystem);
  return { exists: true, raw, sourceVersion, ...backup };
}

module.exports = {
  CURRENT_SCHEMA_MIGRATION_KINDS,
  persistedSchemaVersion,
  detectCurrentSchemaMigration,
  prepareCurrentSchemaMigrationBackup,
  prepareStoreMigration
};
