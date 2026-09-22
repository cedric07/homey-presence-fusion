'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');
const PresenceEngine = require('./lib/presenceEngine');
const {
  getConfig,
  updateUserConfig,
  defaultUserConfig,
  setConfig,
  getOwnerApiKey,
  setOwnerApiKey,
  isForced,
} = require('./lib/configStore');
const {
  listLinkableCapabilities,
  resolveCapability,
  presenceLikenessScore,
  getDeviceCapabilityIds,
} = require('./lib/capabilityMap');

module.exports = class PresenceFusionApp extends Homey.App {

  async onInit() {
    this._api = await HomeyAPI.createAppAPI({ homey: this.homey });
    this._writeApi = null;
    this._writeApiKey = null;
    this._devicesCache = null;
    this._devicesCacheAt = 0;
    this.engine = new PresenceEngine(this);
    await this._syncHomeyUsersIntoConfig();
    await this.engine.start();
    this.log('Presence Fusion has been initialized');
  }

  async onUninit() {
    if (this.engine) await this.engine.stop();
  }

  getApi() {
    return this._api;
  }

  /**
   * Ensure every Homey user has a config entry (disabled by default for new ones? enabled true for simplicity)
   */
  async _syncHomeyUsersIntoConfig() {
    try {
      const users = await this._api.users.getUsers();
      const config = getConfig(this.homey);
      let changed = false;
      for (const user of Object.values(users || {})) {
        if (!user || !user.id) continue;
        if (!config.users[user.id]) {
          config.users[user.id] = {
            ...defaultUserConfig(user.id, user.name || user.id),
            enabled: false, // opt-in per user
          };
          changed = true;
        } else if (user.name && config.users[user.id].name !== user.name) {
          config.users[user.id].name = user.name;
          changed = true;
        }
      }
      if (changed) await setConfig(this.homey, config);
    } catch (err) {
      this.error('sync users failed', err);
    }
  }

  emitPresenceUpdate(userId) {
    try {
      const payload = this.engine.getStatusSnapshot(userId);
      this.homey.api.realtime('presence_updated', payload);
    } catch (err) {
      this.error('realtime emit failed', err);
    }
  }

  async setUserPresent(userId, present) {
    const value = Boolean(present);
    const writeApi = await this._getWriteApi();
    try {
      await writeApi.presence.setPresent({ id: userId, value });
      this.log(`Native presence user=${userId} present=${value}`);
    } catch (err) {
      throw new Error(`Cannot write native presence: ${this._formatApiError(err)}`);
    }
  }

  /**
   * App API sessions are presence.readonly — writes need a Homey Pro API key (homey.presence).
   * @returns {Promise<object>}
   */
  async _getWriteApi() {
    const key = getOwnerApiKey(this.homey);
    if (!key) {
      throw new Error(
        'Missing Homey API key. Create one in Homey Settings → API Keys (include Presence), then paste it in Presence Fusion settings.',
      );
    }
    if (this._writeApi && this._writeApiKey === key) return this._writeApi;

    const address = await this.homey.api.getLocalUrl();
    this._writeApi = await HomeyAPI.createLocalAPI({
      address,
      token: key,
    });
    this._writeApiKey = key;
    return this._writeApi;
  }

  _invalidateWriteApi() {
    this._writeApi = null;
    this._writeApiKey = null;
  }

  _formatApiError(err) {
    if (!err) return 'unknown';
    const code = err.statusCode || err.code || '';
    const desc = err.description || err.error_description || err.message || String(err);
    return code ? `${code} ${desc}` : desc;
  }

  _ownerApiKeyHint(key) {
    if (!key || key.length < 8) return '••••';
    return `••••${key.slice(-4)}`;
  }

  /**
   * Validate token can write presence, then persist.
   * Uses the app API to pick a user (no User scope needed on the key),
   * then probes presence.setPresent with the provided key.
   * @param {string|null} token empty/null clears the key
   */
  async saveOwnerApiKey(token) {
    if (token == null || String(token).trim() === '') {
      await setOwnerApiKey(this.homey, null);
      this._invalidateWriteApi();
      this.log('Homey API key cleared');
      return this.getSettingsBootstrap();
    }

    const trimmed = String(token).trim();
    const address = await this.homey.api.getLocalUrl();
    let probe;
    try {
      // Resolve a user via app session — API key only needs Presence, not Users.
      const users = await this._api.users.getUsers() || {};
      const first = Object.values(users).find((u) => u && u.id);
      if (!first) throw new Error('No Homey users found to verify the API key');

      probe = await HomeyAPI.createLocalAPI({ address, token: trimmed });
      const current = typeof first.present === 'boolean' ? first.present : true;
      await probe.presence.setPresent({ id: first.id, value: current });
    } catch (err) {
      const msg = this._formatApiError(err);
      this.error('API key verification failed:', msg);
      if (String(msg).toLowerCase().includes('scope') || String(err && err.statusCode) === '403') {
        throw new Error(
          'API_KEY_SCOPE: Recreate the Homey API key and check Presence (homey.presence).',
        );
      }
      throw new Error(`API_KEY_INVALID: ${msg}`);
    }

    await setOwnerApiKey(this.homey, trimmed);
    this._invalidateWriteApi();
    this._writeApi = probe;
    this._writeApiKey = trimmed;
    this.log('Homey API key saved and verified');

    // Push forced / fusion state now that writes work
    const config = getConfig(this.homey);
    for (const userId of Object.keys(config.users || {})) {
      const cfg = config.users[userId];
      if (!cfg || cfg.enabled === false) continue;
      if (isForced(cfg)) {
        await this.engine._applyHome(userId, Boolean(cfg.forcedPresent)).catch((err) => this.error(err));
      } else {
        await this.engine.recalculate(userId, 'api-key', { flush: true }).catch((err) => this.error(err));
      }
    }

    return this.getSettingsBootstrap();
  }

  // --- Settings / API helpers ---

  async getSettingsBootstrap() {
    await this._syncHomeyUsersIntoConfig();
    const config = getConfig(this.homey);

    let homeyUsers = {};
    try {
      homeyUsers = await this._api.users.getUsers() || {};
    } catch (err) {
      this.error('getUsers for avatars failed', err);
    }

    const users = Object.values(config.users || {}).map((u) => {
      const snap = this.engine.getStatusSnapshot(u.userId) || {};
      const homeyUser = homeyUsers[u.userId] || null;
      return {
        ...u,
        avatar: this._resolveUserAvatar(homeyUser),
        linkedCount: Object.keys(u.linkedDevices || {}).length,
        home: (homeyUser && typeof homeyUser.present === 'boolean') ? homeyUser.present : snap.home,
        pendingHome: snap.pendingHome,
        lastTransitionAt: snap.lastTransitionAt,
        lastWriteError: snap.lastWriteError || null,
        presenceSources: snap.presenceSources || {},
        forcedPresent: snap.forcedPresent,
      };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return {
      users,
      ownerApiKeyConfigured: Boolean(getOwnerApiKey(this.homey)),
      ownerApiKeyHint: this._ownerApiKeyHint(getOwnerApiKey(this.homey)),
    };
  }

  /**
   * Homey User.avatar is usually https://api.athom.com/user/{athomId}/avatar
   * (generated initials or uploaded photo). Fall back from athomId when needed.
   */
  _resolveUserAvatar(homeyUser) {
    if (!homeyUser) return null;
    if (homeyUser.avatar) return String(homeyUser.avatar);
    if (homeyUser.athomId) {
      return `https://api.athom.com/user/${homeyUser.athomId}/avatar`;
    }
    return null;
  }

  async setUserEnabled(userId, enabled) {
    if (!userId) throw new Error('User not found');
    const existing = getConfig(this.homey).users[userId];
    if (!existing) throw new Error('User not found');

    if (enabled && !getOwnerApiKey(this.homey)) {
      throw new Error('Missing Homey API key. Open the API tab and save a key with Presence first.');
    }

    const patch = { enabled: Boolean(enabled) };
    if (!enabled) {
      patch.forcedPresent = null;
      this.engine.clearHomeTimer(userId);
    }
    const user = await updateUserConfig(this.homey, userId, patch);
    if (enabled) {
      await this.engine.rebindUser(userId);
      await this.engine.recalculate(userId, 'enable', { flush: true });
    } else {
      await this.engine.rebindUser(userId);
    }
    // Refresh widget list (enable/disable changes who appears)
    this.emitPresenceUpdate(userId);
    return user;
  }

  async setUserRules(userId, rules) {
    if (!userId) throw new Error('User not found');
    if (!getConfig(this.homey).users[userId]) throw new Error('User not found');

    const mode = rules.fusionMode || 'or';
    if (!['or', 'and', 'quorum'].includes(mode)) {
      throw new Error('Invalid fusion mode');
    }

    const quorum = Number(rules.quorumN);
    const delayHome = Number(rules.delayHomeSec);
    const delayAway = Number(rules.delayAwaySec);

    if (mode === 'quorum' && (!Number.isFinite(quorum) || quorum < 1 || quorum > 10)) {
      throw new Error('Quorum N must be between 1 and 10');
    }
    if (!Number.isFinite(delayHome) || delayHome < 0 || delayHome > 120) {
      throw new Error('Confirm home must be between 0 and 120 seconds');
    }
    if (!Number.isFinite(delayAway) || delayAway < 60 || delayAway > 3600) {
      throw new Error('Confirm away must be between 60 and 3600 seconds');
    }

    const linkedCount = Object.keys((getConfig(this.homey).users[userId].linkedDevices) || {}).length;
    let quorumN = Number.isFinite(quorum) ? quorum : 2;
    if (mode === 'quorum') {
      if (linkedCount < 1) {
        throw new Error('Link at least one source before using quorum');
      }
      if (quorumN < 1 || quorumN > linkedCount) {
        throw new Error(`Quorum N must be between 1 and ${linkedCount}`);
      }
    }

    const patch = {
      fusionMode: mode,
      quorumN,
      delayHomeSec: delayHome,
      delayAwaySec: delayAway,
    };
    const user = await updateUserConfig(this.homey, userId, patch);
    await this.engine.recalculate(userId, 'rules');
    return user;
  }

  /**
   * @param {string} userId
   * @param {boolean|null} present true/false force, null = auto
   */
  async setUserForcedPresence(userId, present) {
    if (!userId) throw new Error('User not found');
    if (!getConfig(this.homey).users[userId]) throw new Error('User not found');
    if (!getOwnerApiKey(this.homey)) {
      throw new Error('Missing Homey API key. Open the API tab and save a key with Presence first.');
    }
    return this.engine.setForcedPresence(userId, present);
  }

  async getLinkCandidates(query) {
    const q = String(query || '').toLowerCase().trim();
    if (q.length < 2) {
      return { items: [], needQuery: true, minChars: 2 };
    }

    const list = await this._getDevicesCached();
    const items = list
      .filter((d) => {
        if (!d || !d.id) return false;
        const uri = String(d.driverUri || '');
        if (uri.includes('com.cedric07.presencefusion')) return false;
        const hay = `${d.name || ''} ${d.zoneName || ''} ${d.driverId || ''} ${uri}`.toLowerCase();
        return hay.includes(q);
      })
      .map((d) => {
        const caps = listLinkableCapabilities(d);
        const allCaps = getDeviceCapabilityIds(d);
        const suggested = resolveCapability(d, 'presence', 'auto') || caps[0] || allCaps[0] || 'onoff';
        return {
          id: d.id,
          name: d.name || d.id,
          zoneName: d.zoneName || '',
          capability: suggested,
          score: presenceLikenessScore(d),
        };
      })
      .sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name))
      .slice(0, 25);

    return { items, needQuery: false, minChars: 2 };
  }

  async linkDeviceSource(body) {
    if (!body || !body.userId) throw new Error('User not found');
    const cfg = getConfig(this.homey).users[body.userId];
    if (!cfg) throw new Error('User not found');
    if (cfg.enabled === false) throw new Error('User not enabled');
    if (!body.deviceId) throw new Error('Device not found');

    const link = await this.engine.linkDevice(body.userId, {
      deviceId: body.deviceId,
      capability: body.capability || 'auto',
      label: body.label,
      invert: Boolean(body.invert),
      capabilityAuto: body.capabilityAuto !== false,
    });
    return { ok: true, link, bootstrap: await this.getSettingsBootstrap() };
  }

  async unlinkDeviceSource(body) {
    if (!body || !body.userId) throw new Error('User not found');
    if (!body.linkId) throw new Error('Source not found');
    await this.engine.unlinkDevice(body.userId, body.linkId);
    return { ok: true, bootstrap: await this.getSettingsBootstrap() };
  }

  async getDeviceCapabilities(query) {
    const deviceId = query && query.deviceId;
    if (!deviceId) throw new Error('Device not found');
    const api = this.getApi();
    const device = await api.devices.getDevice({ id: deviceId });
    if (!device) throw new Error('Device not found');
    const capabilities = listLinkableCapabilities(device);
    const all = getDeviceCapabilityIds(device);
    const suggested = resolveCapability(device, 'presence', 'auto') || capabilities[0] || all[0] || null;
    return {
      deviceId,
      name: device.name || deviceId,
      capabilities: capabilities.length ? capabilities : all,
      suggested,
    };
  }

  async updateLinkedSource(body) {
    if (!body || !body.userId) throw new Error('User not found');
    if (!body.linkId) throw new Error('Source not found');
    const cfg = getConfig(this.homey).users[body.userId];
    if (!cfg) throw new Error('User not found');
    if (cfg.enabled === false) throw new Error('User not enabled');

    const link = await this.engine.updateLinkedSource(body.userId, body.linkId, {
      capability: body.capability,
      invert: body.invert,
      capabilityAuto: body.capability === 'auto' ? true : body.capabilityAuto,
    });
    return { ok: true, link, bootstrap: await this.getSettingsBootstrap() };
  }

  async getWidgetStatus() {
    const ownerApiKeyConfigured = Boolean(getOwnerApiKey(this.homey));
    if (!ownerApiKeyConfigured) {
      return {
        persons: [],
        ownerApiKeyConfigured: false,
        updatedAt: Date.now(),
      };
    }

    let homeyUsers = {};
    try {
      homeyUsers = await this._api.users.getUsers() || {};
    } catch (err) {
      this.error('getUsers for widget avatars failed', err);
    }

    const enabled = this.engine.getAllStatusSnapshots().filter((p) => p.enabled);

    // Align transition timestamps only (no reconcile — avoids resetting away delays on every widget refresh)
    for (const p of enabled) {
      const homeyUser = homeyUsers[p.userId];
      if (homeyUser && typeof homeyUser.present === 'boolean') {
        await this.engine.syncFromNativePresent(p.userId, homeyUser.present, { reconcile: false });
      }
    }

    const persons = this.engine.getAllStatusSnapshots()
      .filter((p) => p.enabled)
      .map((p) => {
        const homeyUser = homeyUsers[p.userId] || null;
        const nativePresent = homeyUser && typeof homeyUser.present === 'boolean'
          ? Boolean(homeyUser.present)
          : null;
        return {
          ...p,
          home: nativePresent !== null ? nativePresent : p.home,
          avatar: this._resolveUserAvatar(homeyUser),
        };
      });

    return {
      persons,
      ownerApiKeyConfigured: true,
      updatedAt: Date.now(),
    };
  }

  async _getDevicesCached() {
    const TTL_MS = 60 * 1000;
    if (this._devicesCache && (Date.now() - this._devicesCacheAt) < TTL_MS) {
      return this._devicesCache;
    }
    try {
      await this._api.devices.connect();
    } catch (err) {
      this.error('devices.connect failed', err);
    }
    const raw = await this._api.devices.getDevices();
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    this._devicesCache = list;
    this._devicesCacheAt = Date.now();
    return list;
  }

};
