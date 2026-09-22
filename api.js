'use strict';

module.exports = {
  async getBootstrap({ homey }) {
    return homey.app.getSettingsBootstrap();
  },

  async setUserEnabled({ homey, body }) {
    return {
      user: await homey.app.setUserEnabled(body.userId, body.enabled),
      bootstrap: await homey.app.getSettingsBootstrap(),
    };
  },

  async setUserRules({ homey, body }) {
    return {
      user: await homey.app.setUserRules(body.userId, body.rules || body),
      bootstrap: await homey.app.getSettingsBootstrap(),
    };
  },

  async getLinkCandidates({ homey, query }) {
    return homey.app.getLinkCandidates(query && query.q);
  },

  async linkDeviceSource({ homey, body }) {
    return homey.app.linkDeviceSource(body || {});
  },

  async unlinkDeviceSource({ homey, body }) {
    return homey.app.unlinkDeviceSource(body || {});
  },

  async getDeviceCapabilities({ homey, query }) {
    return homey.app.getDeviceCapabilities(query || {});
  },

  async updateLinkedSource({ homey, body }) {
    return homey.app.updateLinkedSource(body || {});
  },

  async saveOwnerApiKey({ homey, body }) {
    return {
      bootstrap: await homey.app.saveOwnerApiKey(body && body.token),
    };
  },
};
