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
const BbPromise = require('bluebird');
const helpers = require('../lib/helpers');
const remove = require('../lib/remove');

class KubelessRemove {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('kubeless');

    this.hooks = {
      'remove:remove': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.removeFunction),
    };
  }

  validate() {
    const unsupportedOptions = ['stage', 'region'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    return BbPromise.resolve();
  }

  removeFunction() {
    const parsedFunctions = _.map(
      this.serverless.service.functions,
      (f, id) => _.assign({ id }, f)
    );
    return remove(parsedFunctions, this.serverless.service.service, {
      namespace: this.serverless.service.provider.namespace,
      verbose: this.options.verbose,
      log: this.serverless.cli.log.bind(this.serverless.cli),
    });
  }
}

module.exports = KubelessRemove;
