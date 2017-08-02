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
    const unsupportedOptions = ['stage', 'region'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    return BbPromise.resolve();
  }

  removeIngressRuleIfNecessary(funcName, namespace) {
    const extensions = new Api.Extensions(helpers.getConnectionOptions(helpers.loadKubeConfig(), {
      namespace,
    }));
    return new BbPromise((resolve, reject) => {
      extensions.ns.ingress.get((err, ingressInfo) => {
        const ingressRule = _.find(ingressInfo.items, item => (
          item.metadata.labels && item.metadata.labels.function === funcName
        ));
        if (!_.isEmpty(ingressRule)) {
          extensions.ns.ingress.delete(ingressRule, (ingErr) => {
            if (ingErr) {
              reject(
                `Unable to remove the ingress rule ${ingressRule}. Received:\n` +
                `  Code: ${ingErr.code}\n` +
                `  Message: ${ingErr.message}`
              );
            } else {
              if (this.options.verbose) {
                this.serverless.cli.log(`Removed Ingress rule ${ingressRule.metadata.name}`);
              }
              resolve();
            }
          });
        } else {
          if (this.options.verbose) {
            this.serverless.cli.log(`Skipping ingress rule clean up for ${funcName}`);
          }
          resolve();
        }
      });
    });
  }

  removeFunction() {
    const errors = [];
    let counter = 0;
    return new BbPromise((resolve, reject) => {
      _.each(this.serverless.service.functions, (desc, f) => {
        this.serverless.cli.log(`Removing function: ${f}...`);
        const connectionOptions = helpers.getConnectionOptions(helpers.loadKubeConfig(), {
          namespace: desc.namespace || this.serverless.service.provider.namespace,
        });
        const thirdPartyResources = new Api.ThirdPartyResources(connectionOptions);
        thirdPartyResources.addResource('functions');
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
            this.removeIngressRuleIfNecessary(f, connectionOptions.namespace)
            .catch((ingErr) => {
              errors.push(ingErr);
            })
            .then(() => {
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
              this.serverless.cli.log(`Function ${f} succesfully deleted`);
            });
          }
        });
      });
    });
  }
}

module.exports = KubelessRemove;
