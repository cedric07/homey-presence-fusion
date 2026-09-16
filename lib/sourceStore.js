'use strict';

/**
 * Normalize / read presence source maps from device store.
 */

/**
 * @param {Record<string, object>} sources
 * @returns {Array<'home'|'away'>}
 */
function presenceStates(sources) {
  return Object.values(sources || {})
    .filter((s) => s && s.enabled !== false)
    .map((s) => s.state)
    .filter((s) => s === 'home' || s === 'away');
}

/**
 * @param {Record<string, object>} sources
 * @returns {string}
 */
function formatSourcesDebug(sources) {
  const entries = Object.entries(sources || {});
  if (!entries.length) return '—';
  return entries
    .map(([label, s]) => {
      const state = (s && s.state) || 'unknown';
      const type = (s && s.type) || 'flow';
      const en = s && s.enabled === false ? 'off' : 'on';
      return `${label}=${state} (${type}/${en})`;
    })
    .join(' · ');
}

/**
 * Parse advanced device-links textarea.
 * Lines: deviceId|capability|label|presence|false
 * @param {string} text
 * @returns {Array<object>}
 */
function parseDeviceLinksText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  const links = [];
  for (const line of lines) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 3) continue;
    const [deviceId, capability, label, , invert = 'false'] = parts;
    if (!deviceId || !capability || !label) continue;
    // V1: presence channel only (sleep = V2)
    links.push({
      deviceId,
      capability: capability || 'auto',
      label,
      channel: 'presence',
      invert: invert === 'true' || invert === '1',
    });
  }
  return links;
}

/**
 * @param {Record<string, object>} linkedDevices
 * @returns {string}
 */
function formatDeviceLinksText(linkedDevices) {
  return Object.values(linkedDevices || {})
    .map((l) => `${l.deviceId}|${l.capability}|${l.label}|${l.channel || 'presence'}|${l.invert ? 'true' : 'false'}`)
    .join('\n');
}

module.exports = {
  presenceStates,
  formatSourcesDebug,
  parseDeviceLinksText,
  formatDeviceLinksText,
};
