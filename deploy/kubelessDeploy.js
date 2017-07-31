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
const fs = require('fs');
const helpers = require('../lib/helpers');
const JSZip = require('jszip');
const moment = require('moment');
const path = require('path');

class KubelessDeploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'deploy:deploy': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.deployFunction),
    };
    // Store the result of loading the Zip file
    this.loadZip = _.memoize(JSZip.loadAsync);
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

  getFunctionContent(relativePath) {
    const pkg = this.options.package ||
      this.serverless.service.package.path;
    let resultPromise = null;
    if (pkg) {
      resultPromise = this.loadZip(fs.readFileSync(pkg)).then(
        (zip) => zip.file(relativePath).async('string')
      );
    } else {
      resultPromise = new BbPromise((resolve, reject) => {
        fs.readFile(
          path.join(this.serverless.config.servicePath || '.', relativePath),
          (err, d) => {
            if (err) {
              reject(err);
            } else {
              resolve(d.toString());
            }
          });
      });
    }
    return resultPromise;
  }

  getThirdPartyResources(modif) {
    return new Api.ThirdPartyResources(
      helpers.getConnectionOptions(helpers.loadKubeConfig(), modif)
    );
  }

  getRuntimeFilenames(runtime, handler) {
    let files = null;
    if (runtime.match(/python/)) {
      files = {
        handler: `${handler.toString().split('.')[0]}.py`,
        deps: 'requirements.txt',
      };
    } else if (runtime.match(/node/)) {
      files = {
        handler: `${handler.toString().split('.')[0]}.js`,
        deps: 'package.json',
      };
    } else if (runtime.match(/ruby/)) {
      files = {
        handler: `${handler.toString().split('.')[0]}.rb`,
        deps: 'Gemfile',
      };
    } else {
      throw new Error(
        `The runtime ${runtime} is not supported yet`
      );
    }
    return files;
  }

  waitForDeployment(funcName, requestMoment, namespace) {
    const core = new Api.Core(helpers.getConnectionOptions(
      helpers.loadKubeConfig(), { namespace })
    );
    let retries = 0;
    const loop = setInterval(() => {
      if (retries > 3) {
        this.serverless.cli.log(
          `Giving up, the deployment of the function ${funcName} seems to have failed. ` +
          'Check the kubeless-controller pod logs for more info'
        );
        clearInterval(loop);
        return;
      }
      retries++;
      let runningPods = 0;
      core.pods.get((err, podsInfo) => {
        if (err) {
          if (err.message.match(/request timed out/)) {
            this.serverless.cli.log('Request timed out. Retrying...');
          } else {
            throw err;
          }
        } else {
          // Get the pods for the current function
          const functionPods = _.filter(
            podsInfo.items,
            (pod) => (
              pod.metadata.labels.function === funcName &&
              // Ignore pods that may still exist from a previous deployment
              moment(pod.metadata.creationTimestamp) >= requestMoment
            )
          );
          if (_.isEmpty(functionPods)) {
            this.serverless.cli.log(
              `Unable to find any running pod for ${funcName}. Retrying...`
            );
          } else {
            _.each(functionPods, pod => {
              // We assume that the function pods will only have one container
              if (pod.status.containerStatuses[0].ready) {
                runningPods++;
              } else if (pod.status.containerStatuses[0].restartCount > 2) {
                throw new Error('Failed to deploy the function');
              }
            });
            if (runningPods === functionPods.length) {
              this.serverless.cli.log(
                `Function ${funcName} succesfully deployed`
              );
              clearInterval(loop);
            } else if (this.options.verbose) {
              this.serverless.cli.log(
                `Waiting for function ${funcName} to be fully deployed. Pods status: ` +
                `${_.map(functionPods, p => JSON.stringify(p.status.containerStatuses[0].state))}`
              );
            }
          }
        }
      });
    }, 2000);
  }

  deployFunctionAndWait(body, thirdPartyResources) {
    const requestMoment = moment().milliseconds(0);
    this.serverless.cli.log(
      `Deploying function ${body.metadata.name}...`
    );
    return new BbPromise((resolve, reject) => {
      thirdPartyResources.ns.functions.post({ body }, (err) => {
        if (err) {
          if (err.code === 409) {
            this.serverless.cli.log(
              `The function ${body.metadata.name} already exists. ` +
              `Remove or redeploy it executing "sls deploy function -f ${body.metadata.name}".`
            );
            resolve();
          } else {
            reject(new Error(
              `Unable to deploy the function ${body.metadata.name}. Received:\n` +
              `  Code: ${err.code}\n` +
              `  Message: ${err.message}`
            ));
          }
        } else {
          this.waitForDeployment(body.metadata.name, requestMoment);
          resolve();
        }
      });
    });
  }

  deployFunction() {
    const errors = [];
    let counter = 0;
    return new BbPromise((resolve, reject) => {
      _.each(this.serverless.service.functions, (description, name) => {
        const runtime = this.serverless.service.provider.runtime;
        const files = this.getRuntimeFilenames(runtime, description.handler);
        const thirdPartyResources = this.getThirdPartyResources({
          namespace: description.namespace ||
          this.serverless.service.provider.namespace,
        });
        thirdPartyResources.addResource('functions');
        this.getFunctionContent(files.handler)
          .then(functionContent => {
            this.getFunctionContent(files.deps)
              .catch(() => {
                // No requirements found
              })
              .then((requirementsContent) => {
                const funcs = {
                  apiVersion: 'k8s.io/v1',
                  kind: 'Function',
                  metadata: {
                    name,
                    namespace: thirdPartyResources.namespaces.namespace,
                  },
                  spec: {
                    deps: requirementsContent || '',
                    function: functionContent,
                    handler: description.handler,
                    runtime: this.serverless.service.provider.runtime,
                    topic: '',
                    type: 'HTTP',
                  },
                };
                this.deployFunctionAndWait(funcs, thirdPartyResources).catch(err => {
                  errors.push(err);
                }).then(() => {
                  counter++;
                  if (counter === _.keys(this.serverless.service.functions).length) {
                    if (_.isEmpty(errors)) {
                      resolve();
                    } else {
                      reject(
                        `Found errors while deploying the given functions:\n${errors.join('\n')}`
                      );
                    }
                  }
                });
              });
          });
      });
    });
  }
}

module.exports = KubelessDeploy;
