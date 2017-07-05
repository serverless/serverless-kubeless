'use strict';

const fs = require('fs');

class CLI {
  constructor() {
    this.log = function () {};
  }
}
const serverless = {
  config: () => {},
  pluginManager: { getPlugins: () => [] },
  classes: { Error, CLI },
  service: {
    getFunction: () => {},
    provider: {},
    resources: {},
    getAllFunctions: () => [],
  },
  cli: new CLI(),
  getProvider: () => ({}),
  utils: {
    fileExistsSync: (p) => fs.existsSync(p),
    readFileSync: (p) => {
      const content = fs.readFileSync(p);
      if (p.endsWith('.json')) {
        return JSON.parse(content);
      }
      return content;
    },
  },
};

module.exports = serverless;
