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
const getLogs = require('../lib/get-logs');
const helpers = require('../lib/helpers');

class KubelessLogs {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('kubeless');
    this.commands = {
      logs: {
        usage: 'Output the logs of a deployed function',
        lifecycleEvents: [
          'logs',
        ],
        options: {
          count: {
            usage: 'Number of lines to print',
            shortcut: 'n',
          },
        },
      },
    };
    this.hooks = {
      'logs:logs': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.printLogs),
    };
  }

  validate() {
    const unsupportedOptions = ['stage', 'region', 'interval'];
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

  printLogs(options) {
    const opts = _.defaults({}, options, {
      startTime: this.options.startTime,
      count: this.options.count,
      filter: this.options.filter,
      silent: false,
      tail: this.options.tail,
      namespace: this.serverless.service.functions[this.options.function].namespace ||
        this.serverless.service.provider.namespace,
    });
    return getLogs(this.options.function, opts);
  }
}

module.exports = KubelessLogs;
