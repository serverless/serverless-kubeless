/*
 Copyright 2017 Bitnami.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

'use strict';

const fs = require('fs');

class CLI {
  constructor() {
    this.log = function () {};
    this.consoleLog = function () {};
  }
}
const serverless = {
  config: () => {},
  pluginManager: { getPlugins: () => [] },
  classes: { Error, CLI },
  service: {
    getFunction: () => {},
    package: {},
    provider: {
      runtime: 'python2.7',
    },
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
