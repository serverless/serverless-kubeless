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
const path = require('path');
const helpers = require('../lib/helpers');
const invoke = require('../lib/invoke');

class KubelessInvoke {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('kubeless');

    this.hooks = {
      'invoke:invoke': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.invokeFunction)
        .then(this.log),
    };
  }

  validate() {
    const unsupportedOptions = ['stage', 'region', 'type'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    if (_.isUndefined(this.serverless.service.functions[this.options.function])) {
      throw new Error(
        `The function ${this.options.function} is not present in the current description`
      );
    }
    return BbPromise.resolve();
  }

  invokeFunction(func, data) {
    const f = func || this.options.function;
    this.serverless.cli.log(`Calling function: ${f}...`);
    let dataPath = this.options.path;
    if (dataPath && !path.isAbsolute(dataPath)) {
      dataPath = path.join(this.serverless.config.servicePath, dataPath);
    }
    return invoke(
      f,
      data || this.options.data,
      _.map(this.serverless.service.functions, (desc, ff) => _.assign({}, desc, { id: ff })),
      {
        namespace: this.serverless.service.provider.namespace,
        path: dataPath,
      }
     );
  }

  log(response) {
    if (this.options.log) {
      console.log('--------------------------------------------------------------------');
      console.log(response.body);
    }
    return BbPromise.resolve();
  }
}

module.exports = KubelessInvoke;
