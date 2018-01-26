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
const Functions = require('./functions');
const helpers = require('./helpers');
const ingressHelper = require('./ingress');
const moment = require('moment');

function getFunctionDescription(
    funcName,
    namespace,
    runtime,
    image,
    deps,
    funcContent,
    contentType,
    handler,
    desc,
    labels,
    env,
    memory,
    eventType,
    eventTrigger,
    eventSchedule,
    timeout,
    port,
    secrets
) {
  const funcs = {
    apiVersion: 'k8s.io/v1',
    kind: 'Function',
    metadata: {
      name: funcName,
      namespace,
    },
    spec: {
      deps: deps || '',
      function: funcContent,
      'function-content-type': contentType,
      handler,
      runtime,
      timeout: String(timeout || '180'),
      service: {
        ports: [{
          name: 'function-port',
          port: Number(port || 8080),
          protocol: 'TCP',
          targetPort: Number(port || 8080),
        }],
        selector: _.assign({}, labels, {
          function: funcName,
        }),
        type: 'ClusterIP',
      },
    },
  };
  if (desc) {
    funcs.metadata.annotations = {
      'kubeless.serverless.com/description': desc,
    };
  }
  if (labels) {
    funcs.metadata.labels = labels;
  }
  if (image || env || memory) {
    const container = {
      name: funcName,
    };
    if (image) {
      container.image = image;
    }
    if (env) {
      container.env = [];
      if (_.isPlainObject(env)) {
        _.each(env, (v, k) => {
          container.env.push({ name: k, value: v.toString() });
        });
      } else if (_.isArray(env)) {
        container.env = _.cloneDeep(env);
      } else {
        throw new Error(
          "Format of 'environment' is unknown: neither dictionary(object) nor array."
        );
      }
    }
    if (memory) {
      // If no suffix is given we assume the unit will be `Mi`
      const memoryWithSuffix = memory.toString().match(/\d+$/) ?
                `${memory}Mi` :
                memory;
      container.resources = {
        limits: { memory: memoryWithSuffix },
        requests: { memory: memoryWithSuffix },
      };
    }
    funcs.spec.template = {
      spec: { containers: [container] },
    };
    if (secrets !== undefined && secrets.length > 0) {
      if (container.volumeMounts === undefined) {
        container.volumeMounts = [];
      }
      if (funcs.spec.template.spec.volumes === undefined) {
        funcs.spec.template.spec.volumes = [];
      }
      secrets.forEach(secret => {
        container.volumeMounts.push({ name: `${secret}-vol`, mountPath: `/${secret}` });
        funcs.spec.template.spec.volumes
          .push({ name: `${secret}-vol`, secret: { secretName: secret } });
      });
    }
  }
  switch (eventType) {
    case 'http':
      funcs.spec.type = 'HTTP';
      break;
    case 'trigger':
      funcs.spec.type = 'PubSub';
      if (_.isEmpty(eventTrigger)) {
        throw new Error('You should specify a topic for the trigger event');
      }
      funcs.spec.topic = eventTrigger;
      break;
    case 'schedule':
      funcs.spec.type = 'Scheduled';
      if (_.isEmpty(eventSchedule)) {
        throw new Error('You should specify a topic for the trigger event');
      }
      funcs.spec.schedule = eventSchedule;
      break;
    default:
      throw new Error(`Event type ${eventType} is not supported`);
  }
  return funcs;
}

function waitForDeployment(funcName, requestMoment, namespace, options) {
  const opts = _.defaults({}, options, {
    verbose: false,
    log: console.log,
  });
  const core = new Api.Core(helpers.getConnectionOptions(
        helpers.loadKubeConfig(), { namespace })
    );
  let retries = 0;
  let successfulCount = 0;
  let previousPodStatus = '';
  return new BbPromise((resolve, reject) => {
    const loop = setInterval(() => {
      if (retries > 3) {
        opts.log(
          `Giving up, unable to retrieve the status of the ${funcName} deployment. `
        );
        clearInterval(loop);
        reject(`Unable to retrieve the status of the ${funcName} deployment`);
      }
      let runningPods = 0;
      core.pods.get((err, podsInfo) => {
        if (err) {
          if (err.message.match(/request timed out/)) {
            opts.log('Request timed out. Retrying...');
          } else {
            throw err;
          }
        } else {
          // Get the pods for the current function
          const functionPods = _.filter(
            podsInfo.items,
            (pod) => (
              !_.isEmpty(pod.metadata.labels) &&
              pod.metadata.labels.function === funcName &&
              // Ignore pods that may still exist from a previous deployment
              moment(pod.metadata.creationTimestamp) >= requestMoment
            )
          );
          if (_.isEmpty(functionPods)) {
            retries++;
            opts.log(`Unable to find any running pod for ${funcName}. Retrying...`);
          } else {
            _.each(functionPods, pod => {
              // We assume that the function pods will only have one container
              if (pod.status.containerStatuses) {
                if (pod.status.containerStatuses[0].ready) {
                  runningPods++;
                } else if (pod.status.containerStatuses[0].restartCount > 2) {
                  opts.log('ERROR: Failed to deploy the function');
                  process.exitCode = process.exitCode || 1;
                  clearInterval(loop);
                }
              }
            });
            if (runningPods === functionPods.length) {
              // The pods may be running for a short time
              // so we should ensure that they are stable
              successfulCount++;
              if (successfulCount === 2) {
                opts.log(`Function ${funcName} successfully deployed`);
                clearInterval(loop);
                resolve();
              }
            } else if (opts.verbose) {
              successfulCount = 0;
              const currentPodStatus = _.map(functionPods, p => (
                p.status.containerStatuses ?
                  JSON.stringify(p.status.containerStatuses[0].state) :
                  'unknown'
              ));
              if (!_.isEqual(previousPodStatus, currentPodStatus)) {
                opts.log(`Pods status: ${currentPodStatus}`);
                previousPodStatus = currentPodStatus;
              }
            } else if (process.exitCode === 1) {
              reject('Failed to deploy some functions');
            }
          }
        }
      });
    }, 2000);
  });
}

function deployFunctionAndWait(body, functions, options) {
  const opts = _.defaults({}, options, {
    verbose: false,
    log: console.log,
  });
  const requestMoment = moment().milliseconds(0);
  opts.log(`Deploying function ${body.metadata.name}...`);
  return new BbPromise((resolve, reject) => {
    functions.post({ body }, (err, res) => {
      if (err) {
        reject(new Error(
            `Unable to deploy the function ${body.metadata.name}. Received:\n` +
            `  Code: ${err.code}\n` +
            `  Message: ${err.message}`
        ));
      } else if (res.code === 409) {
        opts.log(
            `The function ${body.metadata.name} already exists. ` +
            'Redeploy it usign --force or executing ' +
            `"sls deploy function -f ${body.metadata.name}".`
          );
        resolve(false);
      } else if (res.code && res.code !== 200) {
        reject(new Error(
          `Unable to deploy the function ${body.metadata.name}. Received:\n` +
          `  Code: ${res.code}\n` +
          `  Message: ${res.message}`));
      } else {
        waitForDeployment(
            body.metadata.name,
            requestMoment,
            functions.namespace,
            { verbose: opts.verbose, log: opts.log }
        ).catch((waitErr) => {
          reject(waitErr);
        }).then(() => {
          resolve(true);
        });
      }
    });
  });
}

function redeployFunctionAndWait(body, functions, options) {
  const opts = _.defaults({}, options, {
    verbose: false,
  });
  const requestMoment = moment().milliseconds(0);
  return new BbPromise((resolve, reject) => {
    functions.put(body.metadata.name, { body }, (err, res) => {
      if (err) {
        reject(new Error(
            `Unable to update the function ${body.metadata.name}. Received:\n` +
            `  Code: ${err.code}\n` +
            `  Message: ${err.message}`
        ));
      } else if (res.code && res.code !== 200) {
        reject(new Error(
          `Unable to update the function ${body.metadata.name}. Received:\n` +
          `  Code: ${res.code}\n` +
          `  Message: ${res.message}`));
      } else {
        waitForDeployment(
          body.metadata.name,
          requestMoment,
          functions.namespace,
          { verbose: opts.verbose, log: opts.log }
        ).then(() => {
          resolve(true);
        });
      }
    });
  });
}

function deploy(functions, runtime, options) {
  const opts = _.defaults({}, options, {
    hostname: null,
    namespace: 'default',
    memorySize: null,
    force: false,
    verbose: false,
    log: console.log,
    contentType: 'text',
  });
  const errors = [];
  let counter = 0;
  return new BbPromise((resolve, reject) => {
    _.each(functions, (description) => {
      if (description.handler) {
        const functionsApi = new Functions({
          namespace: description.namespace || opts.namespace,
        });
        const events = !_.isEmpty(description.events) ?
          description.events :
          [{ type: 'http', path: '/' }];
        _.each(events, event => {
          const funcs = getFunctionDescription(
              description.id,
              functionsApi.namespace,
              runtime,
              description.image,
              description.deps,
              description.content,
              options.contentType,
              description.handler,
              description.description,
              description.labels,
              description.environment,
              description.memorySize || opts.memorySize,
              event.type,
              event.trigger,
              event.schedule,
              description.timeout || opts.timeout,
              description.port,
              description.secrets
          );
          let deploymentPromise = null;
          let redeployed = false;
          functionsApi.get((err, functionsInfo) => {
            if (err) throw err;
            // Check if the function has been already deployed
            let existingFunction = false;
            let existingSameFunction = false;
            _.each(functionsInfo.items, item => {
              if (_.isEqual(item.metadata.name, funcs.metadata.name)) {
                existingFunction = true;
                if (_.isEqual(item.spec, funcs.spec)) {
                  existingSameFunction = true;
                }
              }
            });
            if (existingSameFunction) {
              // The same function is already deployed, skipping the deployment
              opts.log(`Function ${description.id} has not changed. Skipping deployment`);
              deploymentPromise = new BbPromise(r => r(false));
            } else if (existingFunction && opts.force) {
              // The function already exits but with a different content
              deploymentPromise = redeployFunctionAndWait(
                funcs,
                functionsApi,
                { verbose: opts.verbose, log: opts.log }
              );
              redeployed = true;
            } else {
              deploymentPromise = deployFunctionAndWait(
                funcs,
                functionsApi,
                { verbose: opts.verbose, log: opts.log }
              );
            }
            deploymentPromise.catch(deploymentErr => {
              errors.push(deploymentErr);
            })
            .then((deployed) => {
              counter++;
              if (counter === _.keys(functions).length) {
                if (_.isEmpty(errors)) {
                  let p = null;
                  if (!deployed || redeployed) {
                      // If there were an error with the deployment
                      // or the function is already deployed
                      // don't try to add an ingress rule
                    p = new BbPromise((r) => r());
                  } else {
                    p = ingressHelper.addIngressRuleIfNecessary(functions, {
                      verbose: opts.verbose,
                      log: opts.log,
                      hostname: opts.hostname,
                      defaultDNSResolution: opts.defaultDNSResolution,
                      namespace: functionsApi.namespace,
                    });
                    p.catch(ingressErr => {
                      errors.push(ingressErr);
                    });
                  }
                  p.then(resolve);
                } else {
                  reject(new Error(
                      'Found errors while deploying the given functions:\n' +
                      `${errors.join('\n')}`
                    ));
                }
              }
            });
          });
        });
      } else {
        opts.log(
          `Skipping deployment of ${description.id} since it doesn't have a handler`
        );
      }
    });
  });
}

module.exports = deploy;
