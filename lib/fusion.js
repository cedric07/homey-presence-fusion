'use strict';

const DEFAULTS = {
  fusionMode: 'or',
  quorumN: 2,
  delayHomeSec: 15,
  delayAwaySec: 600,
};

/**
 * @param {'or'|'and'|'quorum'} mode
 * @param {number} quorumN
 * @param {Array<'home'|'away'>} states
 * @returns {boolean|null} true=home, false=away, null=no data
 */
function computeRawHome(mode, quorumN, states) {
  if (!states.length) return null;
  const homeCount = states.filter((s) => s === 'home').length;

  if (mode === 'and') {
    return homeCount === states.length;
  }
  if (mode === 'quorum') {
    const n = Math.max(1, Number(quorumN) || 1);
    return homeCount >= n;
  }
  return homeCount > 0;
}

function rawHome(mode, quorumN, states) {
  return computeRawHome(mode, quorumN, states);
}

module.exports = {
  DEFAULTS,
  computeRawHome,
  rawHome,
};
