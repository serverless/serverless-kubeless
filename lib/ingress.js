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
const Api = require('kubernetes-client');
const helpers = require('./helpers');
const moment = require('moment');
const url = require('url');

function getIngressRuleLabels(functions) {
  const labels = {};
  _.each(functions, (desc, f) => {
    labels[desc.id || f] = '1';
  });
  return labels;
}

function addIngressRuleIfNecessary(functions, options) {
  const opts = _.defaults({}, options, {
    verbose: false,
    log: console.log,
    namespace: 'default',
    hostname: null,
  });
  const config = helpers.loadKubeConfig();
  const extensions = new Api.Extensions(helpers.getConnectionOptions(
    config, { namespace: options.namespace })
  );
  const defaultHostname = `${url.parse(helpers.getKubernetesAPIURL(config)).hostname}.nip.io`;
  const rules = [];
  _.each(functions, (description) => {
    _.each(description.events, event => {
      if (event.type === 'http') {
        const fpath = event.path || '/';
        if (event.path !== '/' || !_.isEmpty(event.hostname)) {
          const hostname = event.hostname || opts.hostname || defaultHostname;
          const absolutePath = _.startsWith(fpath, '/') ?
                        fpath :
                        `/${fpath}`;
          const previousRule = _.findIndex(rules, r => r.host === hostname);
          if (previousRule >= 0) {
            rules[previousRule].http.paths.push({
              path: absolutePath,
              backend: { serviceName: description.id, servicePort: 8080 },
            });
          } else {
            rules.push({
              host: hostname,
              http: {
                paths: [{
                  path: absolutePath,
                  backend: { serviceName: description.id, servicePort: 8080 },
                }],
              },
            });
          }
        }
      }
    });
  });
  return new BbPromise((resolve, reject) => {
    if (!_.isEmpty(rules)) {
      // Found a path to deploy the function
      const labels = getIngressRuleLabels(functions);
      const ingressDef = {
        kind: 'Ingress',
        metadata: {
          name: `ingress-${moment.now()}`,
          labels,
          annotations: {
            'kubernetes.io/ingress.class': 'nginx',
            'ingress.kubernetes.io/rewrite-target': '/',
          },
        },
        spec: { rules },
      };
      extensions.ns.ingress.post({ body: ingressDef }, (err) => {
        if (err) {
          reject(
            'Unable to deploy the ingress rule. ' +
            `Received: ${err.message}`
          );
        } else {
          if (opts.verbose) {
            opts.log('Deployed Ingress rule');
          }
          resolve();
        }
      });
    } else {
      if (opts.verbose) {
        opts.log('Skipping ingress rule generation');
      }
      resolve();
    }
  });
}

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
      const expectedLabels = getIngressRuleLabels(functions);
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

module.exports = {
  getIngressRuleLabels,
  addIngressRuleIfNecessary,
  removeIngressRuleIfNecessary,
};
