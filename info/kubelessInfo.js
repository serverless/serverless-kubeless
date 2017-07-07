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
    helpers.validateEnv();
    const unsupportedOptions = ['stage', 'region'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    return BbPromise.resolve();
  }

  formatMessage(service, functions, options) {
    if (options && !options.color) chalk.enabled = false;
    let message = '';
    message += `\n${chalk.yellow.underline('Service Information')}\n`;
    message += `${chalk.yellow('Service: ')} ${service.name}\n`;
    message += `${chalk.yellow('Cluster IP: ')} ${service.ip}\n`;
    message += `${chalk.yellow('Ports: ')}\n`;
    _.each(service.ports, (port) => {
      // Ports can have variable properties
      _.each(port, (value, key) => {
        message += `  ${chalk.yellow(`${toMultipleWords(key)}: `)} ${value}\n`;
      });
    });
    message += `${chalk.yellow('Functions: ')}\n`;
    _.each(functions, f => {
      message += `  ${chalk.yellow(`${f.name}:`)}\n`;
      message += `    ${chalk.yellow('Handler: ')} ${f.handler}\n`;
      message += `    ${chalk.yellow('Runtime: ')} ${f.runtime}\n`;
      message += `    ${chalk.yellow('Topic: ')} ${f.topic}\n`;
      message += `    ${chalk.yellow('Dependencies: ')} ${f.deps}\n`;
    });
    if (this.options.verbose) {
      message += `\n${chalk.yellow.underline('Service Metadata')}\n`;
      message += `${chalk.yellow('Self Link: ')} ${service.selfLink}\n`;
      message += `${chalk.yellow('UID: ')} ${service.uid}\n`;
      message += `${chalk.yellow('Timestamp: ')} ${service.timestamp}\n`;
      message += `${chalk.yellow('Functions Metadata:')}\n`;
      _.each(functions, f => {
        message += `  ${chalk.yellow(`${f.name}:`)}\n`;
        message += `    ${chalk.yellow('Self Link: ')} ${f.selfLink}\n`;
        message += `    ${chalk.yellow('UID: ')} ${f.uid}\n`;
        message += `    ${chalk.yellow('Timestamp: ')} ${f.timestamp}\n`;
      });
    }
    return message;
  }

  infoFunction(options) {
    const core = new Api.Core(
      Object.assign(helpers.getMinikubeCredentials(), {
        url: process.env.KUBE_API_URL,
        group: 'k8s.io',
      })
    );
    const thirdPartyResources = new Api.ThirdPartyResources(
      Object.assign(helpers.getMinikubeCredentials(), {
        url: process.env.KUBE_API_URL,
        group: 'k8s.io',
      })
    );
    thirdPartyResources.addResource('functions');
    const func = this.serverless.service.service;
    return new BbPromise((resolve) => {
      core.services.get(
        { qs: { labelSelector: `function=${func}` } },
        (err, info) => {
          if (_.isEmpty(info.items)) {
            throw new this.serverless.classes.Error(
              `Unable to find the service for the function ${func}`
            );
          } else if (info.items.length > 1) {
            throw new this.serverless.classes.Error(
              `Found more than one service for the function ${func}`
            );
          }
          const service = {
            name: info.items[0].metadata.name,
            ip: info.items[0].spec.clusterIP,
            ports: info.items[0].spec.ports,
            selfLink: info.items[0].metadata.selfLink,
            uid: info.items[0].metadata.uid,
            timestamp: info.items[0].metadata.creationTimestamp,
          };
          const functions = [];
          thirdPartyResources.ns.functions.get((ferr, functionsInfo) => {
            if (ferr) throw new this.serverless.classes.Error(ferr);
            _.each(functionsInfo.items, f => {
              functions.push({
                name: f.metadata.name,
                handler: f.spec.handler,
                runtime: f.spec.runtime,
                topic: f.spec.topic,
                deps: f.spec.deps,
                selfLink: f.metadata.selfLink,
                uid: f.metadata.uid,
                timestamp: f.metadata.creationTimestamp,
              });
            });
            const message = this.formatMessage(
              service,
              functions,
              _.defaults({}, options, { color: true })
            );
            this.serverless.cli.consoleLog(message);
            resolve(message);
          });
        }
      );
    });
  }
}

module.exports = KubelessInfo;
