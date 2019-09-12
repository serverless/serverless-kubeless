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

const _ = require('lodash');

const Base64ZipContent = require('./strategy/base64_zip_content');

const strategies = {
  Base64ZipContent,
};

class KubelessDeployStrategy {
  constructor(serverless) {
    this.serverless = serverless;
  }

  factory() {
    const deploy = _.assign({}, this.serverless.service.provider.deploy, {
      strategy: 'Base64ZipContent',
      options: {},
    });

    if (deploy.strategy in strategies) {
      return new strategies[deploy.strategy](this, deploy.options);
    }

    throw new Error(`Unknown deploy strategy "${deploy.strategy}"`);
  }
}

module.exports = KubelessDeployStrategy;
