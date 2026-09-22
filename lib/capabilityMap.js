'use strict';

/**
 * Preferred capabilities when auto-detecting a presence source.
 * Presence channel only — asleep is out of scope.
 */
const PREFERRED = {
  presence: [
    'alarm_presence',
    'home',
    'onoff',
    'alarm_generic',
    'alarm_motion',
    'alarm_contact',
  ],
};

/**
 * HomeyAPI devices expose capabilities in several shapes.
 * @param {object} device
 * @returns {string[]}
 */
function getDeviceCapabilityIds(device) {
  if (!device) return [];
  const ids = new Set();

  if (Array.isArray(device.capabilities)) {
    device.capabilities.forEach((c) => ids.add(c));
  } else if (device.capabilities && typeof device.capabilities === 'object') {
    Object.keys(device.capabilities).forEach((c) => ids.add(c));
  }

  if (device.capabilitiesObj && typeof device.capabilitiesObj === 'object') {
    Object.keys(device.capabilitiesObj).forEach((c) => ids.add(c));
  }

  return [...ids];
}

/**
 * @param {object} device HomeyAPI device
 * @param {'presence'} [channel]
 * @param {string} [capability]
 * @returns {string|null}
 */
function resolveCapability(device, channel, capability) {
  const caps = getDeviceCapabilityIds(device);

  if (capability && capability !== 'auto') {
    return caps.includes(capability) ? capability : capability;
  }

  const preferred = PREFERRED.presence;
  const hit = preferred.find((id) => caps.includes(id));
  if (hit) return hit;

  const alarm = caps.find((id) => id.startsWith('alarm_'));
  if (alarm) return alarm;

  if (device.capabilitiesObj) {
    for (const [id, meta] of Object.entries(device.capabilitiesObj)) {
      if (!meta) continue;
      if (meta.type === 'boolean' || typeof meta.value === 'boolean') {
        return id;
      }
    }
  }

  return caps[0] || null;
}

/**
 * Map a raw capability value to a presence fusion state.
 * @param {'presence'} channel
 * @param {*} value
 * @param {boolean} invert
 * @returns {'home'|'away'|null}
 */
function mapCapabilityValue(channel, value, invert = false) {
  if (value === null || value === undefined) return null;

  let truthy;
  if (typeof value === 'boolean') {
    truthy = value;
  } else if (typeof value === 'number') {
    truthy = value > 0;
  } else if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (['home', 'present', 'true', 'on', '1'].includes(v)) truthy = true;
    else if (['away', 'absent', 'false', 'off', '0'].includes(v)) truthy = false;
    else return null;
  } else {
    return null;
  }

  if (invert) truthy = !truthy;

  // Presence channel only
  if (channel === 'presence' || !channel) return truthy ? 'home' : 'away';
  return null;
}

/**
 * Capabilities useful for linking UI (prefer presence-like, else all).
 * @param {object} device
 * @returns {string[]}
 */
function listLinkableCapabilities(device) {
  const caps = getDeviceCapabilityIds(device);
  if (!caps.length) return [];

  const preferred = caps.filter((c) => (
    PREFERRED.presence.includes(c)
    || c.startsWith('alarm_')
    || c === 'onoff'
    || c === 'home'
  ));

  return preferred.length ? preferred : caps;
}

/**
 * Score devices that look like presence sources (for sorting).
 * @param {object} device
 * @returns {number}
 */
function presenceLikenessScore(device) {
  const name = `${device.name || ''} ${device.driverId || ''} ${device.driverUri || ''}`.toLowerCase();
  let score = 0;
  if (name.includes('presence')) score += 50;
  if (name.includes('smart')) score += 20;
  if (name.includes('beacon')) score += 40;
  if (name.includes('tile')) score += 20;
  if (name.includes('phone') || name.includes('iphone') || name.includes('android')) score += 15;
  const caps = getDeviceCapabilityIds(device);
  if (caps.includes('onoff')) score += 10;
  if (caps.includes('alarm_presence')) score += 30;
  if (caps.some((c) => c.startsWith('alarm_'))) score += 5;
  return score;
}

module.exports = {
  PREFERRED,
  getDeviceCapabilityIds,
  resolveCapability,
  mapCapabilityValue,
  listLinkableCapabilities,
  presenceLikenessScore,
};
