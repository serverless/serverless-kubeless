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
const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const helpers = require('../lib/helpers');
const moment = require('moment');

class KubelessLogs {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('google');
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
        .then(this.printLogs)
        .then(() => {
          if (this.options.tail) {
            let m = moment().valueOf();
            setInterval(() => {
              this.printLogs({
                startTime: m,
                count: null,
              });
              m = moment().valueOf();
            }, this.options.interval || 1000);
          }
        }),
    };
  }

  validate() {
    helpers.validateEnv();
    const unsupportedOptions = ['stage', 'region'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    return BbPromise.resolve();
  }

  filterLogs(logs, options) {
    const opts = _.defaults({}, options, {
      startTime: null,
      count: null,
      filter: null,
    });
    let logEntries = _.compact(logs.split('\n'));
    if (opts.count) {
      logEntries = logEntries.slice(logEntries.length - opts.count);
    }
    if (opts.filter) {
      logEntries = _.filter(logEntries, entry => !!entry.match(opts.filter));
    }
    if (opts.startTime) {
      const since = !!opts.startTime.toString().match(/(?:m|h|d)/);
      let startMoment = null;
      if (since) {
        startMoment = moment().subtract(
          opts.startTime.replace(/\D/g, ''),
          opts.startTime.replace(/\d/g, '')
        ).valueOf();
      } else {
        startMoment = moment(opts.startTime).valueOf();
      }
      const logIndex = _.findIndex(logEntries, entry => {
        const entryDate = entry.match(
          /(\d{2}\/[a-zA-Z]{3}\/\d{4}:\d{2}:\d{2}:\d{2} \+\d{4}|-\d{4})/
        );
        if (entryDate) {
          const entryMoment = moment(entryDate[1], 'DD/MMM/YYYY:HH:mm:ss Z').valueOf();
          return entryMoment >= startMoment;
        }
        return false;
      });
      if (logIndex > -1) {
        logEntries = logEntries.slice(logIndex);
      } else {
        // There is no entry after the given startTime
        logEntries = [];
      }
    }
    return logEntries.join('\n');
  }

  printLogs(options) {
    const opts = _.defaults({}, options, {
      startTime: this.options.startTime,
      count: this.options.count,
      filter: this.options.filter,
      silent: false,
    });
    const core = new Api.Core(
      Object.assign(helpers.getMinikubeCredentials(), {
        url: process.env.KUBE_API_URL,
        group: 'k8s.io',
      })
    );
    return new BbPromise((resolve, reject) => {
      core.ns.pods.get((err, podsInfo) => {
        if (err) throw new this.serverless.classes.Error(err);
        const functionPod = _.find(
          podsInfo.items,
          (podInfo) => podInfo.metadata.labels.function === this.options.function
        );
        if (!functionPod) {
          reject(
            `Unable to find the pod for the function ${this.options.function}. ` +
            'Please ensure that there is a function deployed with that ID'
          );
        } else {
          core.ns.pods(functionPod.metadata.name).log.get((errLog, logs) => {
            if (errLog) throw new this.serverless.classes.Error(errLog);
            const filteredLogs = this.filterLogs(logs, opts);
            if (!_.isEmpty(filteredLogs)) {
              if (!opts.silent) {
                console.log(filteredLogs);
              }
            }
            return resolve(filteredLogs);
          });
        }
      });
    });
  }

  logsFunction() {

  }
}

module.exports = KubelessLogs;
