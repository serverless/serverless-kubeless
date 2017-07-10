'use strict';

const _ = require('lodash');
const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const helpers = require('../lib/helpers');

class KubelessRemove {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'remove:remove': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.removeFunction),
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

  removeFunction() {
    const thirdPartyResources = new Api.ThirdPartyResources(
      Object.assign(helpers.getMinikubeCredentials(), {
        url: process.env.KUBE_API_URL,
        group: 'k8s.io',
      })
    );
    thirdPartyResources.addResource('functions');

    const errors = [];
    let counter = 0;
    return new BbPromise((resolve, reject) => {
      _.each(_.keys(this.serverless.service.functions), f => {
        this.serverless.cli.log(`Removing function: ${f}...`);
        // Delete function
        thirdPartyResources.ns.functions.delete(f, (err) => {
          if (err) {
            if (err.code === 404) {
              this.serverless.cli.log(
                `The function ${f} doesn't exist. ` +
                'Skipping removal.'
              );
            } else {
              errors.push(
                `Unable to remove the function ${f}. Received:\n` +
                `  Code: ${err.code}\n` +
                `  Message: ${err.message}`
              );
            }
          } else {
            this.serverless.cli.log(`Function ${f} succesfully deleted`);
          }
          counter++;
          if (counter === _.keys(this.serverless.service.functions).length) {
            if (_.isEmpty(errors)) {
              resolve();
            } else {
              reject(
                'Found errors while removing the given functions:\n' +
                `${errors.join('\n')}`
              );
            }
          }
        });
      });
    });
  }
}

module.exports = KubelessRemove;
