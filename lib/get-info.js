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
const CRD = require('./crd');
const chalk = require('chalk');
const helpers = require('./helpers');

function toMultipleWords(word) {
  return word.replace(/([A-Z])/, ' $1').replace(/^./, (l) => l.toUpperCase());
}

function formatMessage(service, f, options) {
  const opts = _.defaults({}, options, {
    color: false,
    verbose: false,
  });
  if (!opts.color) chalk.enabled = false;
  let message = '';
  message += `\n${chalk.yellow.underline(`Service Information "${service.name}"`)}\n`;
  message += `${chalk.yellow('Cluster IP: ')} ${service.ip}\n`;
  message += `${chalk.yellow('Type: ')} ${service.type}\n`;
  message += `${chalk.yellow('Ports: ')}\n`;
  _.each(service.ports, (port) => {
        // Ports can have variable properties
    _.each(port, (value, key) => {
      message += `  ${chalk.yellow(`${toMultipleWords(key)}: `)} ${value}\n`;
    });
  });
  if (opts.verbose) {
    message += `${chalk.yellow('Metadata')}\n`;
    message += `  ${chalk.yellow('Self Link: ')} ${service.selfLink}\n`;
    message += `  ${chalk.yellow('UID: ')} ${service.uid}\n`;
    message += `  ${chalk.yellow('Timestamp: ')} ${service.timestamp}\n`;
  }
  message += `${chalk.yellow.underline('Function Info')}\n`;
  if (f.url) {
    message += `${chalk.yellow('URL: ')} ${f.url}\n`;
  }
  if (f.annotations && f.annotations['kubeless.serverless.com/description']) {
    message += `${chalk.yellow('Description:')} ` +
            `${f.annotations['kubeless.serverless.com/description']}\n`;
  }
  if (f.labels) {
    message += `${chalk.yellow('Labels:\n')}`;
    _.each(f.labels, (v, k) => {
      message += `${chalk.yellow(`  ${k}:`)} ${v}\n`;
    });
  }
  message += `${chalk.yellow('Handler: ')} ${f.handler}\n`;
  message += `${chalk.yellow('Runtime: ')} ${f.runtime}\n`;
  message += `${chalk.yellow('Dependencies: ')} ${_.trim(f.deps)}\n`;
  if (opts.verbose) {
    message += `${chalk.yellow('Metadata:')}\n`;
    message += `  ${chalk.yellow('Self Link: ')} ${f.selfLink}\n`;
    message += `  ${chalk.yellow('UID: ')} ${f.uid}\n`;
    message += `  ${chalk.yellow('Timestamp: ')} ${f.timestamp}\n`;
  }
  return message;
}

function info(functions, service, options) {
  const opts = _.defaults({}, options, {
    namespace: 'default',
    verbose: false,
    log: console.log,
    color: true,
  });
  let counter = 0;
  let message = '';
  return new BbPromise((resolve, reject) => {
    _.each(functions, (desc, f) => {
      const namespace = desc.namespace || opts.namespace;
      const connectionOptions = helpers.getConnectionOptions(helpers.loadKubeConfig(), {
        namespace,
      });
      const core = new Api.Core(connectionOptions);
      const functionsApi = new CRD('apis/kubeless.io', 'v1beta1', namespace, 'functions');
      const httpTriggerApi = new CRD('apis/kubeless.io', 'v1beta1', namespace, 'httptriggers');
      core.ns.services.get((err, servicesInfo) => {
        if (err) reject(new Error(err));
        functionsApi.getItem(f).catch((ferr) => reject(ferr)).then(fDesc => {
          let tErr;
          let httpTriggerDesc;
          httpTriggerApi.getItem(f).catch((ex) => {
            tErr = ex;
          }).then(res => {
            if (res && res.kind === 'Status') {
              tErr = res;
            } else {
              httpTriggerDesc = res;
            }
          }).finally(() => {
            // eslint-disable-next-line max-len
            if (tErr && ((tErr.code && tErr.code !== 404) || (tErr.statusCode && tErr.statusCode !== 404))) {
              reject(new Error(tErr));
            }
            const functionService = _.find(
              servicesInfo.items,
              (s) => (
                s.metadata.labels &&
                s.metadata.labels.function === f
              )
            );
            if (_.isEmpty(functionService) || _.isEmpty(fDesc)) {
              opts.log(`Not found any information about the function "${f}"`);
            } else {
              let url = null;
              if (httpTriggerDesc) {
                // eslint-disable-next-line max-len
                const protocol = httpTriggerDesc.spec.tls || httpTriggerDesc.spec['tls-secret'] ? 'https' : 'http';
                // eslint-disable-next-line max-len
                url = `${protocol}://${httpTriggerDesc.spec['host-name'] || 'API_URL'}/${httpTriggerDesc.spec.path}`;
              }
              const fService = {
                name: functionService.metadata.name,
                ip: functionService.spec.clusterIP,
                type: functionService.spec.type,
                ports: functionService.spec.ports,
                selfLink: functionService.metadata.selfLink,
                uid: functionService.metadata.uid,
                timestamp: functionService.metadata.creationTimestamp,
              };
              const func = {
                name: f,
                url,
                handler: fDesc.spec.handler,
                runtime: fDesc.spec.runtime,
                topic: fDesc.spec.topic,
                type: fDesc.spec.type,
                deps: fDesc.spec.deps,
                annotations: fDesc.metadata.annotations,
                labels: fDesc.metadata.labels,
                selfLink: fDesc.metadata.selfLink,
                uid: fDesc.metadata.uid,
                timestamp: fDesc.metadata.creationTimestamp,
              };
              message += formatMessage(
                fService,
                func,
                _.defaults({}, opts, { color: opts.color }),
                { verbose: opts.verbose }
              );
            }
            counter++;
            if (counter === _.keys(functions).length) {
              if (!_.isEmpty(message)) {
                opts.log(message);
              }
              resolve(message);
            }
          });
        });
      });
    });
  });
}

module.exports = info;
