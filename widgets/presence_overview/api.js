'use strict';

module.exports = {
  async getStatus({ homey }) {
    return homey.app.getWidgetStatus();
  },

  async setForcedPresence({ homey, body }) {
    const present = body && Object.prototype.hasOwnProperty.call(body, 'present')
      ? body.present
      : null;
    await homey.app.setUserForcedPresence(body.userId, present);
    return homey.app.getWidgetStatus();
  },
};
