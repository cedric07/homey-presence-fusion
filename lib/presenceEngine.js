'use strict';

const { rawHome, DEFAULTS } = require('./fusion');
const {
  getConfig,
  getUserConfig,
  updateUserConfig,
  getUserRuntime,
  updateUserRuntime,
  isForced,
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
    // Boot: re-apply forced presence, else recalculate fusion
    const config = getConfig(this.homey);
    for (const userId of Object.keys(config.users || {})) {
      const cfg = config.users[userId];
      if (!cfg || cfg.enabled === false) continue;
      if (isForced(cfg)) {
        await this._applyHome(userId, Boolean(cfg.forcedPresent)).catch((err) => this.app.error(err));
      } else {
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
      this.syncFromNativePresent(userId, present, { reconcile: true })
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

    const forced = isForced(cfg);
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
      lastWriteError: rt.lastWriteError || null,
      forcedPresent: forced ? Boolean(cfg.forcedPresent) : null,
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
   * @param {string} userId
   * @param {boolean} nativePresent
   * @param {{ reconcile?: boolean }} [opts] reconcile=true → push fusion if sources disagree with native
   * @returns {Promise<boolean>} true if bookkeeping changed
   */
  async syncFromNativePresent(userId, nativePresent, opts = {}) {
    if (typeof nativePresent !== 'boolean') return false;
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return false;

    const rt = getUserRuntime(this.homey, userId);
    const native = Boolean(nativePresent);
    let changed = false;

    if (rt.lastHome === null) {
      // Adopt current native state without inventing an arrival/departure time
      await updateUserRuntime(this.homey, userId, { lastHome: native });
    } else if (rt.lastHome !== native) {
      await updateUserRuntime(this.homey, userId, {
        lastHome: native,
        lastTransitionAt: Date.now(),
        pendingHome: null,
      });
      this._clearHomeTimer(userId);
      this.app.log(`[${cfg.name || userId}] native presence → ${native ? 'home' : 'away'} (sync transition)`);
      changed = true;
    }

    // Only when native actually moved (watcher) — never from widget refresh (avoids delay reset loops)
    if (opts.reconcile === true) {
      if (isForced(cfg)) {
        // Keep forced state if Homey was changed elsewhere
        if (native !== Boolean(cfg.forcedPresent)) {
          await this._applyHome(userId, Boolean(cfg.forcedPresent));
        }
        return changed;
      }
      const states = Object.values(getUserRuntime(this.homey, userId).presenceSources || {})
        .map((s) => s && s.state)
        .filter((s) => s === 'home' || s === 'away');
      const targetHome = rawHome(
        cfg.fusionMode || DEFAULTS.fusionMode,
        Number(cfg.quorumN) || DEFAULTS.quorumN,
        states,
      );
      if (targetHome !== null && targetHome !== native) {
        await this.recalculate(userId, 'native-sync');
      }
    }
    return changed;
  }

  /**
   * @param {string} userId
   * @returns {Promise<boolean|null>}
   */
  async _getNativePresent(userId) {
    const api = this.app.getApi();
    try {
      if (typeof api.presence.getPresent === 'function') {
        const value = await api.presence.getPresent({ id: userId });
        if (typeof value === 'boolean') return value;
        if (value && typeof value.present === 'boolean') return value.present;
        if (value && typeof value.value === 'boolean') return value.value;
      }
    } catch (err) {
      this.app.error('presence.getPresent failed', err);
    }
    try {
      const users = await api.users.getUsers() || {};
      const user = users[userId];
      if (user && typeof user.present === 'boolean') return user.present;
    } catch (err) {
      this.app.error('getUsers failed', err);
    }
    return null;
  }

  /**
   * Fusion target from linked devices (internal home/away after capability map).
   * @returns {boolean|null}
   */
  _targetFromSources(userId, cfg) {
    const rt = getUserRuntime(this.homey, userId);
    const sources = rt.presenceSources || {};
    const links = Object.values(cfg.linkedDevices || {});
    const mode = cfg.fusionMode || DEFAULTS.fusionMode;
    const quorumN = Math.max(1, Number(cfg.quorumN) || DEFAULTS.quorumN);

    if (!links.length) {
      const states = Object.values(sources)
        .map((s) => s && s.state)
        .filter((s) => s === 'home' || s === 'away');
      return rawHome(mode, quorumN, states);
    }

    const states = links.map((link) => {
      const key = link && (link.id || link.deviceId);
      const st = key && sources[key] ? sources[key].state : null;
      if (st === 'home' || st === 'away') return st;
      return 'unknown';
    });

    const known = states.filter((s) => s === 'home' || s === 'away');
    if (!known.length && mode !== 'and') {
      return null;
    }

    if (mode === 'and') {
      // Every linked source must be home; unknown counts as not home
      if (!states.length) return null;
      if (!known.length) return null;
      return states.every((s) => s === 'home');
    }

    if (mode === 'quorum') {
      const homeCount = states.filter((s) => s === 'home').length;
      return homeCount >= quorumN;
    }

    // OR
    return states.some((s) => s === 'home');
  }

  /**
   * @param {string} userId
   * @param {string} sourceKey stable id (prefer link.id)
   * @param {'home'|'away'} state
   * @param {{ type?: string, deviceId?: string, label?: string, flush?: boolean }} [opts]
   */
  async signalPresence(userId, sourceKey, state, opts = {}) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return;

    const key = String(sourceKey || 'source').trim() || 'source';
    if (state !== 'home' && state !== 'away') {
      throw new Error('Invalid presence state');
    }

    const rt = getUserRuntime(this.homey, userId);
    const sources = { ...(rt.presenceSources || {}) };
    const label = String(opts.label || (sources[key] && sources[key].label) || key).trim() || key;
    sources[key] = {
      ...(sources[key] || {}),
      state,
      label,
      type: opts.type || (sources[key] && sources[key].type) || 'device',
      deviceId: opts.deviceId || (sources[key] && sources[key].deviceId) || null,
      updatedAt: Date.now(),
    };
    await updateUserRuntime(this.homey, userId, { presenceSources: sources });
    this.app.log(`[${cfg.name || userId}] source "${label}" (${key}) => ${state}`);
    await this.recalculate(userId, 'presence', { flush: Boolean(opts.flush) });
  }

  async recalculate(userId, reason, opts = {}) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg || cfg.enabled === false) return;

    if (isForced(cfg)) {
      this.app.log(`[${cfg.name || userId}] recalculate (${reason}) skipped — forced present=${cfg.forcedPresent}`);
      this.app.emitPresenceUpdate(userId);
      return;
    }

    const flush = Boolean(opts.flush);
    const targetHome = this._targetFromSources(userId, cfg);

    if (targetHome === null) {
      this._clearHomeTimer(userId);
      const rt = getUserRuntime(this.homey, userId);
      if (rt.pendingHome !== null) {
        await updateUserRuntime(this.homey, userId, { pendingHome: null });
      }
      this.app.emitPresenceUpdate(userId);
      return;
    }
    this.app.log(`[${cfg.name || userId}] recalculate (${reason}) → home=${targetHome}`);
    await this._scheduleHome(userId, targetHome, cfg, flush);
    this.app.emitPresenceUpdate(userId);
  }

  async _scheduleHome(userId, targetHome, cfg, flush) {
    const rt = getUserRuntime(this.homey, userId);
    const nativePresent = await this._getNativePresent(userId);

    // Gate on native Homey presence — not only our lastHome cache
    if (typeof nativePresent === 'boolean' && nativePresent === targetHome) {
      this._clearHomeTimer(userId);
      if (rt.lastHome !== targetHome || rt.pendingHome !== null) {
        await updateUserRuntime(this.homey, userId, {
          lastHome: targetHome,
          pendingHome: null,
        });
      } else {
        await updateUserRuntime(this.homey, userId, { pendingHome: null });
      }
      return;
    }

    const delaySec = targetHome
      ? (Number.isFinite(Number(cfg.delayHomeSec)) ? Number(cfg.delayHomeSec) : DEFAULTS.delayHomeSec)
      : (Number.isFinite(Number(cfg.delayAwaySec)) ? Number(cfg.delayAwaySec) : DEFAULTS.delayAwaySec);

    // Cache said we already applied, but native disagrees → write now (no extra delay)
    const desyncRepair = rt.lastHome === targetHome
      && typeof nativePresent === 'boolean'
      && nativePresent !== targetHome;

    if (flush || delaySec <= 0 || desyncRepair) {
      if (desyncRepair) {
        this.app.log(
          `[${cfg.name || userId}] desync: lastHome=${rt.lastHome} native=${nativePresent} target=${targetHome} — write now`,
        );
      }
      this._clearHomeTimer(userId);
      await updateUserRuntime(this.homey, userId, { pendingHome: null });
      await this._applyHome(userId, targetHome);
      return;
    }

    const existing = this._homeTimers.get(userId);
    if (rt.pendingHome === targetHome && existing) return;

    this._clearHomeTimer(userId);
    await updateUserRuntime(this.homey, userId, { pendingHome: targetHome });
    this.app.log(`[${cfg.name || userId}] confirm home=${targetHome} in ${delaySec}s (native=${nativePresent})`);
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
    if (isForced(cfg)) return;

    const targetHome = this._targetFromSources(userId, cfg);

    await updateUserRuntime(this.homey, userId, { pendingHome: null });

    if (targetHome === pending) {
      await this._applyHome(userId, pending);
    } else if (targetHome !== null) {
      await this._scheduleHome(userId, targetHome, cfg, false);
    }
  }

  /**
   * Force native presence (or clear with present=null). Until manual Auto.
   * @param {string} userId
   * @param {boolean|null} present true/false force, null = resume fusion
   */
  async setForcedPresence(userId, present) {
    const cfg = getUserConfig(this.homey, userId);
    if (!cfg) throw new Error('User not found');
    if (cfg.enabled === false) throw new Error('User not enabled');

    if (present === null || present === undefined) {
      await this._clearForce(userId, { resume: true });
      return getUserConfig(this.homey, userId);
    }

    if (present !== true && present !== false) {
      throw new Error('Invalid forced presence');
    }

    this._clearHomeTimer(userId);
    await updateUserRuntime(this.homey, userId, { pendingHome: null });

    // Write native first — only persist force if Homey accepts it
    const ok = await this._applyHome(userId, Boolean(present));
    if (!ok) {
      const rt = getUserRuntime(this.homey, userId);
      throw new Error(rt.lastWriteError || 'Failed to set native presence');
    }

    await updateUserConfig(this.homey, userId, {
      forcedPresent: Boolean(present),
    });
    this.app.log(`[${cfg.name || userId}] forced present=${present} (until clear)`);
    this.app.emitPresenceUpdate(userId);
    return getUserConfig(this.homey, userId);
  }

  async _clearForce(userId, opts = {}) {
    await updateUserConfig(this.homey, userId, {
      forcedPresent: null,
    });
    if (opts.resume) {
      this.app.log(`[force] ${userId} → auto (resume fusion)`);
      await this.recalculate(userId, 'force-clear', { flush: true });
    }
  }

  /**
   * @returns {Promise<boolean>} true if native write succeeded
   */
  async _applyHome(userId, present) {
    const value = Boolean(present);
    const rt = getUserRuntime(this.homey, userId);
    const prev = rt.lastHome;
    const cfg = getUserConfig(this.homey, userId);

    try {
      await this.app.setUserPresent(userId, value);
      const now = Date.now();
      await updateUserRuntime(this.homey, userId, {
        lastHome: value,
        lastNativeWriteAt: now,
        lastTransitionAt: prev === value ? rt.lastTransitionAt : now,
        pendingHome: null,
        lastWriteError: null,
      });
      this.app.log(`[${(cfg && cfg.name) || userId}] applied native present=${value}`);
    } catch (err) {
      this.app.error(`Failed to set native presence for ${userId}`, err);
      await updateUserRuntime(this.homey, userId, {
        lastWriteError: String((err && err.message) || err),
      }).catch(() => {});
      return false;
    }

    this.app.emitPresenceUpdate(userId);
    return true;
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
    if (removed.id && sources[removed.id]) {
      delete sources[removed.id];
    }
    await updateUserRuntime(this.homey, userId, { presenceSources: sources });

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

    if (key !== nextId) {
      const rt = getUserRuntime(this.homey, userId);
      const sources = { ...(rt.presenceSources || {}) };
      if (sources[key]) {
        sources[nextId] = { ...sources[key], label: updated.label || sources[key].label };
        delete sources[key];
        await updateUserRuntime(this.homey, userId, { presenceSources: sources });
      }
    }

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
    const sourceKey = link.id || link.deviceId || 'source';
    const mapped = mapCapabilityValue('presence', value, link.invert);
    if (!mapped) {
      const rt = getUserRuntime(this.homey, userId);
      const sources = { ...(rt.presenceSources || {}) };
      if (sources[sourceKey]) {
        sources[sourceKey] = {
          ...sources[sourceKey],
          state: 'unknown',
          label: link.label || sourceKey,
          deviceId: link.deviceId || null,
          updatedAt: Date.now(),
        };
        await updateUserRuntime(this.homey, userId, { presenceSources: sources });
        await this.recalculate(userId, 'unknown');
      }
      return;
    }
    await this.signalPresence(userId, sourceKey, mapped, {
      type: 'device',
      deviceId: link.deviceId,
      label: link.label,
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

  /** Public alias for disable / external callers. */
  clearHomeTimer(userId) {
    this._clearHomeTimer(userId);
  }

};
