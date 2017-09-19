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

function removeIngressRuleIfNecessary(functions, namespace, options) {
  const opts = _.defaults({}, options, {
    verbose: false,
    log: console.log,
  });
  const extensions = new Api.Extensions(helpers.getConnectionOptions(helpers.loadKubeConfig(), {
    namespace,
  }));
  return new BbPromise((resolve, reject) => {
    extensions.ns.ingress.get((err, ingressInfo) => {
      const expectedLabels = {};
      _.each(functions, f => {
        expectedLabels[f.id] = '1';
      });
      const ingressRule = _.find(ingressInfo.items, item => (
        item.metadata.labels && _.isEqual(item.metadata.labels, expectedLabels)
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
            if (opts.verbose) {
              opts.log(`Removed Ingress rule ${ingressRule.metadata.name}`);
            }
            resolve();
          }
        });
      } else {
        if (opts.verbose) {
          opts.log('Skipping ingress rule clean up');
        }
        resolve();
      }
    });
  });
}

function removeFunction(functions, options) {
  const opts = _.defaults({}, options, {
    namespace: null,
    verbose: false,
    log: console.log,
  });
  const errors = [];
  let counter = 0;
  return new BbPromise((resolve, reject) => {
    _.each(functions, (desc) => {
      opts.log(`Removing function: ${desc.id}...`);
      const connectionOptions = helpers.getConnectionOptions(helpers.loadKubeConfig(), {
        namespace: desc.namespace || opts.namespace,
      });
      const thirdPartyResources = new Api.ThirdPartyResources(connectionOptions);
      thirdPartyResources.addResource('functions');
      // Delete function
      thirdPartyResources.ns.functions.delete(desc.id, (err) => {
        if (err) {
          if (err.code === 404) {
            opts.log(
              `The function ${desc.id} doesn't exist. ` +
              'Skipping removal.'
            );
          } else {
            errors.push(
              `Unable to remove the function ${desc.id}. Received:\n` +
              `  Code: ${err.code}\n` +
              `  Message: ${err.message}`
            );
          }
        } else {
          counter++;
          if (counter === _.keys(functions).length) {
            removeIngressRuleIfNecessary(
              functions,
              connectionOptions.namespace,
              { verbose: opts.verbose, log: opts.log }
            )
            .catch((ingErr) => {
              errors.push(ingErr);
            })
            .then(() => {
              if (_.isEmpty(errors)) {
                opts.log(`Function ${desc.id} successfully deleted`);
                resolve();
              } else {
                reject(
                  'Found errors while removing the given functions:\n' +
                  `${errors.join('\n')}`
                );
              }
            });
          }
        }
      });
    });
  });
}

module.exports = removeFunction;
