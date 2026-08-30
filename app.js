'use strict';

const Homey = require('homey');

module.exports = class PresenceFusionApp extends Homey.App {

  async onInit() {
    this.log('Presence Fusion has been initialized');
  }

};
