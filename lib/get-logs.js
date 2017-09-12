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
const request = require('request');

function filterLogs(logs, options) {
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
    const logIndex = _.findIndex(logEntries, (entry) => {
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

function printFilteredLogs(logs, opts) {
  const filteredLogs = filterLogs(logs, opts);
  if (!_.isEmpty(filteredLogs)) {
    if (!opts.silent) {
      console.log(filteredLogs);
    }
  }
  return filteredLogs;
}

function printLogs(func, options) {
  const config = helpers.loadKubeConfig();
  const opts = _.defaults({}, options, {
    namespace: options.namespace || helpers.getDefaultNamespace(config),
    startTime: null,
    count: null,
    filter: null,
    silent: false,
    tail: false,
    onData: (d) => {
      const logs = d.toString().trim() || '';
      return printFilteredLogs(logs, opts);
    },
  });
  const core = new Api.Core(helpers.getConnectionOptions(config, { namespace: opts.namespace }));
  return new BbPromise((resolve, reject) => {
    core.ns.pods.get((err, podsInfo) => {
      if (err) reject(new Error(err));
      const functionPods = _.filter(
                podsInfo.items,
                (podInfo) => (
                    podInfo.metadata.labels.function === func
                )
            );
      if (_.isEmpty(functionPods)) {
        reject(
            new Error(`Unable to find the pod for the function ${func}. ` +
              'Please ensure that there is a function deployed with that ID')
            );
      } else {
        _.each(functionPods, functionPod => {
          if (opts.tail) {
            const APIRootUrl = helpers.getKubernetesAPIURL(helpers.loadKubeConfig());
            const url = `${APIRootUrl}/api/v1/namespaces/${opts.namespace}/pods/` +
                            `${functionPod.metadata.name}/log?follow=true`;
            const connectionOptions = Object.assign(
              helpers.getConnectionOptions(helpers.loadKubeConfig()),
              { url }
            );
            request.get(
              connectionOptions
            ).on('data', opts.onData);
          } else {
            core.ns.pods(functionPod.metadata.name).log.get((errLog, logs) => {
              if (errLog) reject(new Error(errLog));
              const filteredLogs = printFilteredLogs(logs || '', opts);
              resolve(filteredLogs);
            });
          }
        });
      }
    });
  });
}

module.exports = printLogs;
