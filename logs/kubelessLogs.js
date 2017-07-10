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
          let m = moment().valueOf();
          let previousResult = null;
          if (this.options.tail) {
            setInterval(() => {
              this.printLogs({
                startTime: m,
                count: null,
                silent: true,
              }).then((logs) => {
                m = moment().valueOf();
                if (logs !== previousResult && !_.isEmpty(logs)) {
                  console.log(logs);
                }
                previousResult = logs;
              });
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
}

module.exports = KubelessLogs;
