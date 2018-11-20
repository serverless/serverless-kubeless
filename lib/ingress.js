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
const url = require('url');

function addIngressRuleIfNecessary(ruleName, functions, options) {
  const opts = _.defaults({}, options, {
    verbose: false,
    log: console.log,
    namespace: 'default',
    hostname: null,
    defaultDNSResolution: 'nip.io',
    ingress: _.defaults({
      class: 'nginx',
      additionalAnnotations: {},
      tlsConfig: undefined,
    }),
  });
  const config = helpers.loadKubeConfig();
  const extensions = new Api.Extensions(helpers.getConnectionOptions(
    config, { namespace: options.namespace })
  );
  const defaultHostname =
    `${url.parse(helpers.getKubernetesAPIURL(config)).hostname}.${opts.defaultDNSResolution}`;
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
      const ingressDef = {
        kind: 'Ingress',
        metadata: {
          name: ruleName,
          annotations: _.merge({
            'kubernetes.io/ingress.class': opts.ingress.class,
            [`${opts.ingress.class}.ingress.kubernetes.io/rewrite-target`]: '/',
          }, opts.ingress.additionalAnnotations),
        },
        spec: { rules, tls: opts.ingress.tlsConfig },
      };
      extensions.ns.ingress.get(ruleName, (err) => {
        if (err === null) {
          // Update existing ingress rule
          extensions.ns.ingress(ruleName).put({ body: ingressDef }, (ingErr, res) => {
            if (ingErr) {
              reject(
                'Unable to deploy the ingress rule. ' +
                `Received: ${ingErr.message}`
              );
            } else {
              if (opts.verbose) {
                opts.log(`Updated Ingress rule ${ruleName}`);
              }
              resolve(res);
            }
          });
        } else {
          // Create new
          extensions.ns.ingress.post({ body: ingressDef }, (ingErr, res) => {
            if (ingErr) {
              reject(
                'Unable to deploy the ingress rule. ' +
                `Received: ${ingErr.message}`
              );
            } else {
              if (opts.verbose) {
                opts.log(`Deployed Ingress rule ${ruleName}`);
              }
              resolve(res);
            }
          });
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

function removeIngressRule(ruleName, namespace, options) {
  const opts = _.defaults({}, options, {
    verbose: false,
    log: console.log,
  });
  const extensions = opts.apiExtensions ||
    new Api.Extensions(helpers.getConnectionOptions(helpers.loadKubeConfig(), {
      namespace,
    }));
  return new BbPromise((resolve, reject) => {
    try {
      extensions.ns.ingress.delete(ruleName, (err, res) => {
        if (err) {
          if (err.message.match(/not found/)) {
            // Ingress rule doesn't exists
            resolve();
          } else {
            reject(err);
          }
        } else {
          if (opts.verbose) {
            opts.log(`Removed Ingress rule ${ruleName}`);
          }
          resolve(res);
        }
      });
    } catch (e) {
      resolve();
    }
  });
}

module.exports = {
  addIngressRuleIfNecessary,
  removeIngressRule,
};
