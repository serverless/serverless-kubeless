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
const chalk = require('chalk');
const helpers = require('../lib/helpers');

function toMultipleWords(word) {
  return word.replace(/([A-Z])/, ' $1').replace(/^./, (l) => l.toUpperCase());
}

class KubelessInfo {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('google');
    this.commands = {
      info: {
        usage: 'Display information about the current functions',
        lifecycleEvents: [
          'info',
        ],
        options: {
          verbose: {
            usage: 'Display metadata',
            shortcut: 'v',
          },
        },
      },
    };
    this.hooks = {
      'info:info': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.infoFunction),
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

  formatMessage(service, f, options) {
    if (options && !options.color) chalk.enabled = false;
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
    if (this.options.verbose) {
      message += `${chalk.yellow('Metadata')}\n`;
      message += `  ${chalk.yellow('Self Link: ')} ${service.selfLink}\n`;
      message += `  ${chalk.yellow('UID: ')} ${service.uid}\n`;
      message += `  ${chalk.yellow('Timestamp: ')} ${service.timestamp}\n`;
    }
    message += `${chalk.yellow.underline('Function Info')}\n`;
    message += `${chalk.yellow('Handler: ')} ${f.handler}\n`;
    message += `${chalk.yellow('Runtime: ')} ${f.runtime}\n`;
    message += `${chalk.yellow('Topic: ')} ${f.topic}\n`;
    message += `${chalk.yellow('Dependencies: ')} ${f.deps}`;
    if (this.options.verbose) {
      message += `\n${chalk.yellow('Metadata:')}\n`;
      message += `  ${chalk.yellow('Self Link: ')} ${f.selfLink}\n`;
      message += `  ${chalk.yellow('UID: ')} ${f.uid}\n`;
      message += `  ${chalk.yellow('Timestamp: ')} ${f.timestamp}`;
    }
    return message;
  }

  infoFunction(options) {
    let counter = 0;
    let message = '';
    return new BbPromise((resolve) => {
      _.each(this.serverless.service.functions, (desc, f) => {
        const connectionOptions = helpers.getConnectionOptions(helpers.loadKubeConfig(), {
          namespace: desc.namespace || this.serverless.service.provider.namespace,
        });
        const core = new Api.Core(connectionOptions);
        const thirdPartyResources = new Api.ThirdPartyResources(connectionOptions);
        thirdPartyResources.addResource('functions');
        core.services.get((err, servicesInfo) => {
          thirdPartyResources.ns.functions.get((ferr, functionsInfo) => {
            if (ferr) throw new this.serverless.classes.Error(ferr);
            const fDesc = _.find(functionsInfo.items, item => item.metadata.name === f);
            const functionService = _.find(
                servicesInfo.items,
                (service) => (
                  service.metadata.labels &&
                  service.metadata.labels.function === f
                )
              );
            const service = {
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
              handler: fDesc.spec.handler,
              runtime: fDesc.spec.runtime,
              topic: fDesc.spec.topic,
              deps: fDesc.spec.deps,
              selfLink: fDesc.metadata.selfLink,
              uid: fDesc.metadata.uid,
              timestamp: fDesc.metadata.creationTimestamp,
            };
            message += this.formatMessage(
              service,
              func,
              _.defaults({}, options, { color: true })
            );
            counter++;
            if (counter === _.keys(this.serverless.service.functions).length) {
              this.serverless.cli.consoleLog(message);
              resolve(message);
            }
          });
        });
      });
    });
  }
}

module.exports = KubelessInfo;
