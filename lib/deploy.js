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
const CRD = require('./crd');
const helpers = require('./helpers');
const ingressHelper = require('./ingress');
const moment = require('moment');

/** Supported message queue types */
const MQTypes = Object.freeze({ kafka: 'Kafka', nats: 'NATS' });

function forceString(obj) {
  const result = {};
  _.each(obj, (v, k) => {
    if (v === null) {
      result[k] = 'null';
    } else if (v === undefined) {
      result[k] = 'undefined';
    } else if (typeof v === 'object') {
      result[k] = JSON.stringify(v);
    } else {
      result[k] = v.toString();
    }
  });
  return result;
}

function parseEnv(src) {
  let res = [];
  if (_.isPlainObject(src)) {
    _.each(src, (v, k) => {
      res.push({ name: k, value: v.toString() });
    });
  } else if (_.isArray(src)) {
    res = _.cloneDeep(src);
  } else {
    throw new Error(
      "Format of 'environment' is unknown: neither dictionary(object) nor array."
    );
  }
  return res;
}

function getFunctionDescription(
    funcName,
    namespace,
    runtime,
    image,
    deps,
    funcContent,
    contentType,
    checksum,
    handler,
    desc,
    labels,
    annotations,
    env,
    memory,
    timeout,
    port,
    secrets,
    cpu,
    affinity,
    tolerations
) {
  const funcs = {
    apiVersion: 'kubeless.io/v1beta1',
    kind: 'Function',
    metadata: {
      name: funcName,
      namespace,
      labels: forceString(_.assign({}, labels, {
        'created-by': 'kubeless',
        function: funcName,
      })),
      annotations: annotations || {},
    },
    spec: {
      deps: deps || '',
      function: funcContent,
      checksum,
      'function-content-type': contentType,
      handler,
      runtime,
      timeout: String(timeout || '180'),
      service: {
        ports: [{
          name: 'http-function-port',
          port: Number(port || 8080),
          protocol: 'TCP',
          targetPort: Number(port || 8080),
        }],
        selector: {
          function: funcName,
        },
        type: 'ClusterIP',
      },
    },
  };
  if (desc) {
    funcs.metadata.annotations['kubeless.serverless.com/description'] = desc;
  }
  if (image || env || memory || secrets || cpu || affinity || tolerations) {
    const container = {
      name: funcName,
    };
    if (image) {
      container.image = image;
    }
    if (env) {
      container.env = parseEnv(env);
    }
    if (memory || cpu) {
      container.resources = { limits: {}, requests: {} };
      if (memory) {
        // If no suffix is given we assume the unit will be `Mi`
        const memoryWithSuffix = memory.toString().match(/\d+$/) ?
                  `${memory}Mi` :
                  memory;
        container.resources.limits.memory = memoryWithSuffix;
        container.resources.requests.memory = memoryWithSuffix;
      }
      if (cpu) {
        container.resources.limits.cpu = cpu;
        container.resources.requests.cpu = cpu;
      }
    }

    funcs.spec.deployment = {
      spec: {
        template: {
          spec: {
            containers: [container],
          },
        },
      },
    };
    if (secrets !== undefined && secrets.length > 0) {
      if (container.volumeMounts === undefined) {
        container.volumeMounts = [];
      }
      if (funcs.spec.deployment.spec.template.spec.volumes === undefined) {
        funcs.spec.deployment.spec.template.spec.volumes = [];
      }
      secrets.forEach(secret => {
        container.volumeMounts.push({ name: `${secret}-vol`, mountPath: `/${secret}` });
        funcs.spec.deployment.spec.template.spec.volumes
          .push({ name: `${secret}-vol`, secret: { secretName: secret } });
      });
    }

    if (affinity) {
      funcs.spec.deployment.spec.template.spec.affinity = affinity;
    }
    if (tolerations) {
      funcs.spec.deployment.spec.tolerations = tolerations;
    }
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
      core.ns.pods.get((err, podsInfo) => {
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
              !pod.metadata.deletionTimestamp
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
    functions.post({ body })
    .catch(err => {
      reject(new Error(
      `Unable to deploy the function ${body.metadata.name}. Received:\n` +
      `  Code: ${err.code}\n` +
      `  Message: ${err.message}`));
    }).then((res) => {
      if (res && res.code && res.code === 409) {
        opts.log(
          `The function ${body.metadata.name} already exists. ` +
          'Redeploy it usign --force or executing ' +
          `"sls deploy function -f ${body.metadata.name}".`
        );
        resolve(false);
      } else if (res && res.code && res.code !== 200) {
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
    functions.put(body.metadata.name, { body }).catch((err) => reject(new Error(
      `Unable to update the function ${body.metadata.name}. Received:\n` +
      `  Code: ${err.code}\n` +
      `  Message: ${err.message}`
    ))).then((res) => {
      if (res.code && res.code !== 200) {
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

/**
 * Handling Kafka and NATS message queue trigger
 *
 * @param {MQTypes} mqType
 * @param {string} name
 * @param {string} namespace
 * @param {string} topic
 * @param {object} options
 */
function deployMQTrigger(mqType, name, namespace, topic, options) {
  const opts = _.defaults({}, options, {
    log: console.log,
  });
  const trigger = {
    apiVersion: 'kubeless.io/v1beta1',
    kind: `${mqType}Trigger`,
    metadata: {
      name: helpers.escapeName(`${name}-${topic}`),
      namespace,
      labels: {
        'created-by': 'kubeless',
      },
    },
    spec: {
      functionSelector: {
        matchLabels: {
          'created-by': 'kubeless',
          function: name,
        },
      },
      topic,
    },
  };
  const triggerApi = new CRD(
    'apis/kubeless.io',
    'v1beta1',
    namespace,
    `${mqType.toLowerCase()}triggers`
  );
  opts.log(`Deploying ${mqType} trigger: ${trigger.metadata.name}`);
  return triggerApi.getItem(trigger.metadata.name)
    .then((res) => {
      if (res.code === 404) {
        return triggerApi.post({ body: trigger });
      }
      opts.log(`Updating existing ${mqType} trigger`);
      return triggerApi.put(trigger.metadata.name, { body: trigger });
    });
}

function deployScheduleTrigger(name, namespace, schedule, options) {
  const trigger = {
    apiVersion: 'kubeless.io/v1beta1',
    kind: 'CronJobTrigger',
    metadata: {
      name,
      namespace,
      labels: {
        'created-by': 'kubeless',
      },
    },
    spec: {
      'function-name': name,
      schedule,
    },
  };
  const scheduleTriggerApi = new CRD('apis/kubeless.io', 'v1beta1', namespace, 'cronjobtriggers');
  options.log(`Creating scheduled trigger for: ${trigger.metadata.name}`);
  return scheduleTriggerApi.getItem(trigger.metadata.name)
    .then((res) => {
      if (res.code === 404) {
        return scheduleTriggerApi.post({ body: trigger });
      }
      options.log('Updating existing schedule');
      return scheduleTriggerApi.put(trigger.metadata.name, { body: trigger });
    });
}

function deployFunction(f, namespace, runtime, contentType, options) {
  const functionsApi = new CRD('apis/kubeless.io', 'v1beta1', namespace, 'functions');
  let environment = options.environment ? parseEnv(options.environment) : null;
  if (f.environment) {
    const fenv = parseEnv(f.environment);
    environment = environment ? environment.concat(fenv) : fenv;
  }
  const funcs = getFunctionDescription(
    f.id,
    namespace,
    runtime,
    f.image,
    f.deps,
    f.content,
    contentType,
    f.checksum,
    f.handler,
    f.description,
    f.labels,
    f.annotations,
    environment,
    f.memorySize || options.memorySize,
    f.timeout || options.timeout,
    f.port,
    f.secrets,
    f.cpu || options.cpu,
    f.affinity || options.affinity,
    f.tolerations || options.tolerations
  );
  return functionsApi.getItem(funcs.metadata.name).then((res) => {
    if (res.code === 404) {
      return deployFunctionAndWait(
        funcs,
        functionsApi,
        { verbose: options.verbose, log: options.log }
      );
    }
    if (!options.force) {
      // The same function is already deployed, skipping the deployment
      options.log(`Function ${f.id} already exists. Skipping deployment`);
      return new BbPromise(r => r(false));
    }
    // The function already exits but with a different content
    return redeployFunctionAndWait(
      funcs,
      functionsApi,
      { verbose: options.verbose, log: options.log }
    );
  });
}

/**
 * Handle message queue trigger input to normalize the users input values.
 *
 * @param {string|object} trigger
 * @param {string} name
 * @param {string} namespace
 * @param {object} options
 */
function handleMQTDeployment(trigger, name, namespace, options) {
  let mqTrigger = trigger;
  // If only a string is passed, expect it to be the subject
  if (typeof mqTrigger === 'string') {
    // Defaults to Kafka
    mqTrigger = {
      queue: 'kafka',
      topic: mqTrigger,
    };
  } else {
    // Otherwise expect type and subject to be set
    if (_.isEmpty(mqTrigger.queue)) {
      throw new Error('You should specify a queue for the trigger event (i.e. kafka, nats)');
    }
    if (_.isEmpty(mqTrigger.topic)) {
      throw new Error('You should specify a topic for the trigger event');
    }
  }

  return deployMQTrigger(
    MQTypes[mqTrigger.queue.toLowerCase()],
    name,
    namespace,
    mqTrigger.topic,
    { log: options.log }
  );
}

function deployTrigger(event, funcName, namespace, service, options) {
  let triggerPromise = new BbPromise((r) => r());
  switch (event.type) {
    case 'http':
      // TODO: Rely on Kubeless httptrigger object when it support paths
      break;
    case 'trigger':
      if (_.isEmpty(event.trigger)) {
        throw new Error('You should specify a topic or queue & topic for the trigger event');
      }
      triggerPromise = handleMQTDeployment(
        event.trigger,
        funcName,
        namespace,
        { log: options.log }
      );
      break;
    case 'schedule':
      if (_.isEmpty(event.schedule)) {
        throw new Error('You should specify a schedule for the trigger event');
      }
      triggerPromise = deployScheduleTrigger(
        funcName,
        namespace,
        event.schedule,
        { log: options.log }
      );
      break;
    default:
      throw new Error(`Event type ${event.type} is not supported`);
  }
  return triggerPromise;
}

function deploy(functions, runtime, service, options) {
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

  // Total number of elements to deploy
  const elements = helpers.getDeployableItemsNumber(functions);
  return new BbPromise((resolve, reject) => {
    _.each(functions, (description) => {
      const ns = description.namespace || opts.namespace;
      if (description.handler) {
        deployFunction(description, ns, runtime, opts.contentType, opts)
          .catch(deploymentErr => errors.push(deploymentErr))
          .then((res) => {
            if (res.code && res.code !== 200) {
              errors.push(res.message);
            }
            counter++;
            helpers.checkFinished(counter, elements, errors, resolve, reject, {
              onSuccess: () => ingressHelper.addIngressRuleIfNecessary(service, functions, {
                verbose: options.verbose,
                log: options.log,
                hostname: options.hostname,
                defaultDNSResolution: options.defaultDNSResolution,
                ingress: options.ingress,
                namespace: ns,
              }),
            });
          });
        _.each(description.events, event => {
          deployTrigger(event, description.id, ns, service, opts)
            .catch(triggerErr => errors.push(triggerErr))
            .then((res) => {
              if (res && res.code && res.code !== 200) {
                errors.push(res.message);
              }
              counter++;
              helpers.checkFinished(counter, elements, errors, resolve, reject, {
                onSuccess: () => ingressHelper.addIngressRuleIfNecessary(service, functions, {
                  verbose: options.verbose,
                  log: options.log,
                  hostname: options.hostname,
                  defaultDNSResolution: options.defaultDNSResolution,
                  ingress: options.ingress,
                  namespace: ns,
                }),
              });
            });
        });
      } else {
        counter++;
        opts.log(
          `Skipping deployment of ${description.id} since it doesn't have a handler`
        );
        helpers.checkFinished(counter, elements, errors, resolve, reject);
      }
    });
  });
}

module.exports = deploy;
