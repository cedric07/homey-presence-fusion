'use strict';

const { DEFAULTS } = require('./fusion');

const CONFIG_KEY = 'fusionConfig';
const RUNTIME_KEY = 'fusionRuntime';
const OWNER_API_KEY = 'ownerApiKey';

/**
 * @returns {object}
 */
function emptyConfig() {
  return { users: {} };
}

/**
 * Homey Pro API key used to write native presence (apps lack homey.presence write scope).
 * @param {import('homey').Homey} homey
 * @returns {string|null}
 */
function getOwnerApiKey(homey) {
  const raw = homey.settings.get(OWNER_API_KEY);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

/**
 * @param {import('homey').Homey} homey
 * @param {string|null} token
 */
async function setOwnerApiKey(homey, token) {
  if (token == null || String(token).trim() === '') {
    if (typeof homey.settings.unset === 'function') {
      homey.settings.unset(OWNER_API_KEY);
    } else {
      await homey.settings.set(OWNER_API_KEY, '');
    }
    return null;
  }
  const trimmed = String(token).trim();
  await homey.settings.set(OWNER_API_KEY, trimmed);
  return trimmed;
}

/**
 * @param {string} userId
 * @param {string} [name]
 */
function defaultUserConfig(userId, name = '') {
  return {
    userId,
    name,
    enabled: true,
    fusionMode: DEFAULTS.fusionMode,
    quorumN: DEFAULTS.quorumN,
    delayHomeSec: DEFAULTS.delayHomeSec,
    delayAwaySec: DEFAULTS.delayAwaySec,
    linkedDevices: {},
    // null = auto (fusion). true/false = forced native present (until manual clear).
    forcedPresent: null,
  };
}

/**
 * Active force override.
 * @param {object|null} cfg
 * @returns {boolean}
 */
function isForced(cfg) {
  if (!cfg) return false;
  return cfg.forcedPresent === true || cfg.forcedPresent === false;
}

/**
 * @param {import('homey').Homey} homey
 */
function getConfig(homey) {
  const raw = homey.settings.get(CONFIG_KEY);
  if (!raw || typeof raw !== 'object') return emptyConfig();
  if (!raw.users || typeof raw.users !== 'object') return { ...raw, users: {} };
  return raw;
}

/**
 * @param {import('homey').Homey} homey
 * @param {object} config
 */
async function setConfig(homey, config) {
  await homey.settings.set(CONFIG_KEY, config);
}

/**
 * @param {import('homey').Homey} homey
 */
function getRuntime(homey) {
  const raw = homey.settings.get(RUNTIME_KEY);
  if (!raw || typeof raw !== 'object') return { users: {} };
  if (!raw.users || typeof raw.users !== 'object') return { users: {} };
  return raw;
}

/**
 * @param {import('homey').Homey} homey
 * @param {object} runtime
 */
async function setRuntime(homey, runtime) {
  await homey.settings.set(RUNTIME_KEY, runtime);
}

/**
 * @param {import('homey').Homey} homey
 * @param {string} userId
 */
function getUserConfig(homey, userId) {
  const config = getConfig(homey);
  return config.users[userId] || null;
}

/**
 * @param {import('homey').Homey} homey
 * @param {string} userId
 * @param {object} patch
 */
async function updateUserConfig(homey, userId, patch) {
  const config = getConfig(homey);
  const current = config.users[userId] || defaultUserConfig(userId);
  config.users[userId] = { ...current, ...patch, userId };
  await setConfig(homey, config);
  return config.users[userId];
}

/**
 * @param {import('homey').Homey} homey
 * @param {string} userId
 */
function getUserRuntime(homey, userId) {
  const runtime = getRuntime(homey);
  return runtime.users[userId] || {
    presenceSources: {},
    pendingHome: null,
    lastHome: null,
    lastTransitionAt: null,
    lastNativeWriteAt: null,
    lastWriteError: null,
  };
}

/**
 * @param {import('homey').Homey} homey
 * @param {string} userId
 * @param {object} patch
 */
async function updateUserRuntime(homey, userId, patch) {
  const runtime = getRuntime(homey);
  const current = getUserRuntime(homey, userId);
  runtime.users[userId] = { ...current, ...patch };
  await setRuntime(homey, runtime);
  return runtime.users[userId];
}

module.exports = {
  CONFIG_KEY,
  RUNTIME_KEY,
  OWNER_API_KEY,
  DEFAULTS,
  emptyConfig,
  defaultUserConfig,
  isForced,
  getConfig,
  setConfig,
  getRuntime,
  setRuntime,
  getUserConfig,
  updateUserConfig,
  getUserRuntime,
  updateUserRuntime,
  getOwnerApiKey,
  setOwnerApiKey,
};
