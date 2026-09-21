'use strict';

const { rawHome, DEFAULTS } = require('./fusion');
const {
  getConfig,
  getUserConfig,
  updateUserConfig,
  getUserRuntime,
  updateUserRuntime,
} = require('./configStore');
const {
  resolveCapability,
  mapCapabilityValue,
  getDeviceCapabilityIds,
} = require('./capabilityMap');

/**
 * App-level presence fusion engine (no Homey devices).
 */
module.exports = class PresenceEngine {

  /**
   * @param {import('../app')} app
   */
  constructor(app) {
    this.app = app;
    this.homey = app.homey;
    this._homeTimers = new Map();
    this._capInstances = new Map(); // key: `${userId}:${linkId}`
    this._binding = false;
  }

  async start() {
    await this.rebindAll();
    await this._watchNativePresence().catch((err) => this.app.error('watch native presence failed', err));
    // Recalculate enabled users once at boot
    const config = getConfig(this.homey);
    for (const userId of Object.keys(config.users || {})) {
      if (config.users[userId].enabled !== false) {
        await this.recalculate(userId, 'boot').catch((err) => this.app.error(err));
      }
    }
  }

  async _watchNativePresence() {
    const api = this.app.getApi();
    try {
      await api.users.connect();
    } catch (err) {
      this.app.error('users.connect failed', err);
    }

    const onPresent = (userId, present) => {
      if (typeof present !== 'boolean') return;
      this.syncFromNativePresent(userId, present)
        .then((changed) => {
          if (changed) this.app.emitPresenceUpdate(userId);
        })
        .catch((err) => this.app.error(err));
    };

    // Manager-level CRUD realtime (homey-api emits "user.update")
    if (typeof api.users.on === 'function' && !api.users.__pfPresenceWatch) {
      api.users.__pfPresenceWatch = true;
      api.users.on('user.update', (user) => {
        if (!user || !user.id) return;
        if (typeof user.present !== 'boolean') return;
        onPresent(user.id, user.present);
      });
    }

    const users = await api.users.getUsers() || {};
    for (const user of Object.values(users)) {
      if (!user || !user.id || typeof user.on !== 'function') continue;
      if (user.__pfPresenceWatch) continue;
      user.__pfPresenceWatch = true;
      // Item-level: homey-api emits "update" (not "$update")
      user.on('update', (props) => {
        if (!props || !Object.prototype.hasOwnProperty.call(props, 'present')) return;
        if (typeof props.present !== 'boolean') return;
        onPresent(user.id, props.present);
      });
    }
  }

  async stop() {
    for (const timer of this._homeTimers.values()) {
      this.homey.clearTimeout(timer);
    }
    this._homeTimers.clear();
    await this._unbindAll();
  }

  /**
   * Snapshot for widget / settings debug.
   */
  getStatusSnapshot(userId) {
    const cfg = getUserConfig(this.homey, userId);
    const rt = getUserRuntime(this.homey, userId);
    if (!cfg) return null;

    return {
      userId,
      name: cfg.name || userId,
      enabled: cfg.enabled !== false,
      fusionMode: cfg.fusionMode || DEFAULTS.fusionMode,
      home: rt.lastHome,
      pendingHome: rt.pendingHome,
      presenceSources: rt.presenceSources || {},
      linkedDevices: cfg.linkedDevices || {},
      lastTransitionAt: rt.lastTransitionAt || null,
      lastNativeWriteAt: rt.lastNativeWriteAt || null,
    };
  }

  getAllStatusSnapshots() {
    const config = getConfig(this.homey);
    return Object.keys(config.users || {})
      .map((id) => this.getStatusSnapshot(id))
      .filter(Boolean);
  }

  /**
   * Keep lastHome / lastTransitionAt aligned with native Homey presence.
   * Native is the source of truth; we only store the transition timestamp Homey doesn't expose.
   * @returns {Promise<boolean>} true if bookkeeping changed
   */
  async syncFromNativePresent(userId, nativePresent) {
    if (typeof nativePresent !== 'boolean') return false;
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return false;

    const rt = getUserRuntime(this.homey, userId);
    const native = Boolean(nativePresent);

    if (rt.lastHome === null) {
      // Adopt current native state without inventing an arrival/departure time
      await updateUserRuntime(this.homey, userId, { lastHome: native });
      return false;
    }

    if (rt.lastHome === native) return false;

    await updateUserRuntime(this.homey, userId, {
      lastHome: native,
      lastTransitionAt: Date.now(),
      pendingHome: null,
    });
    this._clearHomeTimer(userId);
    this.app.log(`[${cfg.name || userId}] native presence → ${native ? 'home' : 'away'} (sync transition)`);
    return true;
  }

  /**
   * @param {string} userId
   * @param {string} sourceLabel
   * @param {'home'|'away'} state
   * @param {{ type?: string, deviceId?: string, flush?: boolean }} [opts]
   */
  async signalPresence(userId, sourceLabel, state, opts = {}) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return;

    const label = String(sourceLabel || 'source').trim() || 'source';
    if (state !== 'home' && state !== 'away') {
      throw new Error('Invalid presence state');
    }

    const rt = getUserRuntime(this.homey, userId);
    const sources = { ...(rt.presenceSources || {}) };
    sources[label] = {
      ...(sources[label] || {}),
      state,
      type: opts.type || (sources[label] && sources[label].type) || 'device',
      deviceId: opts.deviceId || (sources[label] && sources[label].deviceId) || null,
      updatedAt: Date.now(),
    };
    await updateUserRuntime(this.homey, userId, { presenceSources: sources });
    this.app.log(`[${cfg.name || userId}] source "${label}" => ${state}`);
    await this.recalculate(userId, 'presence', { flush: Boolean(opts.flush) });
  }

  async recalculate(userId, reason, opts = {}) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return;

    const flush = Boolean(opts.flush);
    const rt = getUserRuntime(this.homey, userId);
    const states = Object.values(rt.presenceSources || {})
      .map((s) => s && s.state)
      .filter((s) => s === 'home' || s === 'away');

    const targetHome = rawHome(
      cfg.fusionMode || DEFAULTS.fusionMode,
      Number(cfg.quorumN) || DEFAULTS.quorumN,
      states,
    );

    if (targetHome === null) return;
    await this._scheduleHome(userId, targetHome, cfg, flush);
    this.app.emitPresenceUpdate(userId);
  }

  async _scheduleHome(userId, targetHome, cfg, flush) {
    const rt = getUserRuntime(this.homey, userId);
    const current = rt.lastHome;

    if (current === targetHome) {
      this._clearHomeTimer(userId);
      await updateUserRuntime(this.homey, userId, { pendingHome: null });
      return;
    }

    const delaySec = targetHome
      ? (Number.isFinite(Number(cfg.delayHomeSec)) ? Number(cfg.delayHomeSec) : DEFAULTS.delayHomeSec)
      : (Number.isFinite(Number(cfg.delayAwaySec)) ? Number(cfg.delayAwaySec) : DEFAULTS.delayAwaySec);

    if (flush || delaySec <= 0) {
      this._clearHomeTimer(userId);
      await updateUserRuntime(this.homey, userId, { pendingHome: null });
      await this._applyHome(userId, targetHome);
      return;
    }

    const existing = this._homeTimers.get(userId);
    if (rt.pendingHome === targetHome && existing) return;

    this._clearHomeTimer(userId);
    await updateUserRuntime(this.homey, userId, { pendingHome: targetHome });
    this.app.log(`[${cfg.name || userId}] confirm home=${targetHome} in ${delaySec}s`);
    this.app.emitPresenceUpdate(userId);

    const timer = this.homey.setTimeout(() => {
      this._homeTimers.delete(userId);
      this._confirmAndApplyHome(userId, targetHome).catch((err) => this.app.error(err));
    }, delaySec * 1000);
    this._homeTimers.set(userId, timer);
  }

  async _confirmAndApplyHome(userId, pending) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return;

    const rt = getUserRuntime(this.homey, userId);
    const states = Object.values(rt.presenceSources || {})
      .map((s) => s && s.state)
      .filter((s) => s === 'home' || s === 'away');
    const targetHome = rawHome(
      cfg.fusionMode || DEFAULTS.fusionMode,
      Number(cfg.quorumN) || DEFAULTS.quorumN,
      states,
    );

    await updateUserRuntime(this.homey, userId, { pendingHome: null });

    if (targetHome === pending) {
      await this._applyHome(userId, pending);
    } else if (targetHome !== null) {
      await this._scheduleHome(userId, targetHome, cfg, false);
    }
  }

  async _applyHome(userId, present) {
    const value = Boolean(present);
    const rt = getUserRuntime(this.homey, userId);
    const prev = rt.lastHome;

    try {
      await this.app.setUserPresent(userId, value);
      const now = Date.now();
      await updateUserRuntime(this.homey, userId, {
        lastHome: value,
        lastNativeWriteAt: now,
        lastTransitionAt: prev === value ? rt.lastTransitionAt : now,
        pendingHome: null,
      });
    } catch (err) {
      this.app.error(`Failed to set native presence for ${userId}`, err);
      return;
    }

    this.app.emitPresenceUpdate(userId);
  }

  async linkDevice(userId, link) {
    const api = this.app.getApi();
    const device = await api.devices.getDevice({ id: link.deviceId });
    if (!device) throw new Error('Device not found');

    const capability = resolveCapability(device, 'presence', link.capability || 'auto')
      || getDeviceCapabilityIds(device)[0]
      || 'onoff';

    const label = String(link.label || device.name || capability).trim();
    const linkId = `${link.deviceId}:${capability}:presence`;

    const cfg = getUserConfig(this.homey, userId) || await updateUserConfig(this.homey, userId, {});
    const linked = { ...(cfg.linkedDevices || {}) };
    linked[linkId] = {
      id: linkId,
      deviceId: link.deviceId,
      deviceName: device.name || link.deviceId,
      capability,
      label,
      channel: 'presence',
      invert: Boolean(link.invert),
      capabilityAuto: link.capabilityAuto !== false,
    };
    await updateUserConfig(this.homey, userId, { linkedDevices: linked });
    await this.rebindUser(userId);

    const value = device.capabilitiesObj && device.capabilitiesObj[capability]
      ? device.capabilitiesObj[capability].value
      : null;
    await this._onLinkedCapability(userId, linked[linkId], value);
    return linked[linkId];
  }

  async unlinkDevice(userId, linkId) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg) throw new Error('User not found');
    const linked = { ...(cfg.linkedDevices || {}) };

    let key = linkId;
    let removed = linked[linkId];
    if (!removed) {
      const entry = Object.entries(linked).find(([, l]) => (
        l && (l.id === linkId || l.label === linkId || l.deviceId === linkId)
      ));
      if (entry) {
        key = entry[0];
        removed = entry[1];
      }
    }
    if (!removed) throw new Error('Source not found');

    delete linked[key];
    await updateUserConfig(this.homey, userId, { linkedDevices: linked });

    const rt = getUserRuntime(this.homey, userId);
    const sources = { ...(rt.presenceSources || {}) };
    if (removed.label && sources[removed.label]) {
      delete sources[removed.label];
      await updateUserRuntime(this.homey, userId, { presenceSources: sources });
    }

    await this.rebindUser(userId);
    await this.recalculate(userId, 'unlink');
    return true;
  }

  /**
   * Override capability / invert on an existing linked source.
   * @param {string} userId
   * @param {string} linkId
   * @param {{ capability?: string, invert?: boolean }} patch
   */
  async updateLinkedSource(userId, linkId, patch = {}) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg) throw new Error('User not found');
    if (cfg.enabled === false) throw new Error('User not enabled');

    const linked = { ...(cfg.linkedDevices || {}) };
    let key = linkId;
    let existing = linked[linkId];
    if (!existing) {
      const entry = Object.entries(linked).find(([, l]) => (
        l && (l.id === linkId || l.label === linkId || l.deviceId === linkId)
      ));
      if (entry) {
        key = entry[0];
        existing = entry[1];
      }
    }
    if (!existing) throw new Error('Source not found');

    const api = this.app.getApi();
    const device = await api.devices.getDevice({ id: existing.deviceId });
    if (!device) throw new Error('Device not found');

    const wantAuto = !patch.capability || patch.capability === 'auto' || patch.capabilityAuto === true;
    const nextCapability = wantAuto
      ? (resolveCapability(device, 'presence', 'auto')
        || getDeviceCapabilityIds(device)[0]
        || existing.capability)
      : (resolveCapability(device, 'presence', patch.capability) || patch.capability);
    if (!nextCapability) throw new Error('Capability not found');

    const invert = patch.invert !== undefined ? Boolean(patch.invert) : Boolean(existing.invert);
    const nextId = `${existing.deviceId}:${nextCapability}:presence`;

    delete linked[key];
    const updated = {
      ...existing,
      id: nextId,
      deviceName: device.name || existing.deviceName,
      capability: nextCapability,
      invert,
      capabilityAuto: wantAuto,
      channel: 'presence',
    };
    linked[nextId] = updated;
    await updateUserConfig(this.homey, userId, { linkedDevices: linked });

    await this.rebindUser(userId);
    await this.recalculate(userId, 'capability', { flush: true });
    return updated;
  }

  async rebindAll() {
    await this._unbindAll();
    const config = getConfig(this.homey);
    for (const userId of Object.keys(config.users || {})) {
      if (config.users[userId].enabled === false) continue;
      await this.rebindUser(userId);
    }
  }

  async rebindUser(userId) {
    // Drop existing bindings for this user
    for (const [key, instance] of [...this._capInstances.entries()]) {
      if (key.startsWith(`${userId}:`)) {
        try {
          if (instance && typeof instance.destroy === 'function') instance.destroy();
        } catch (err) {
          this.app.error(err);
        }
        this._capInstances.delete(key);
      }
    }

    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return;

    const api = this.app.getApi();
    try {
      await api.devices.connect();
    } catch (err) {
      this.app.error('devices.connect failed', err);
    }

    for (const link of Object.values(cfg.linkedDevices || {})) {
      try {
        const device = await api.devices.getDevice({ id: link.deviceId });
        if (!device || !device.makeCapabilityInstance) continue;
        const instance = device.makeCapabilityInstance(link.capability, (value) => {
          this._onLinkedCapability(userId, link, value).catch((err) => this.app.error(err));
        });
        this._capInstances.set(`${userId}:${link.id}`, instance);

        const value = device.capabilitiesObj && device.capabilitiesObj[link.capability]
          ? device.capabilitiesObj[link.capability].value
          : null;
        await this._onLinkedCapability(userId, link, value);
      } catch (err) {
        this.app.error(`Bind failed ${link.label}`, err);
      }
    }
  }

  async _onLinkedCapability(userId, link, value) {
    if (!link) return;
    const mapped = mapCapabilityValue('presence', value, link.invert);
    if (!mapped) {
      const rt = getUserRuntime(this.homey, userId);
      const sources = { ...(rt.presenceSources || {}) };
      if (sources[link.label]) {
        sources[link.label] = { ...sources[link.label], state: 'unknown', updatedAt: Date.now() };
        await updateUserRuntime(this.homey, userId, { presenceSources: sources });
        await this.recalculate(userId, 'unknown');
      }
      return;
    }
    await this.signalPresence(userId, link.label, mapped, {
      type: 'device',
      deviceId: link.deviceId,
    });
  }

  async _unbindAll() {
    for (const instance of this._capInstances.values()) {
      try {
        if (instance && typeof instance.destroy === 'function') instance.destroy();
      } catch (err) {
        this.app.error(err);
      }
    }
    this._capInstances.clear();
  }

  _clearHomeTimer(userId) {
    const timer = this._homeTimers.get(userId);
    if (timer) {
      this.homey.clearTimeout(timer);
      this._homeTimers.delete(userId);
    }
  }

};
