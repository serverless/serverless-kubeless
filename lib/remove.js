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
const CRD = require('./crd');
const helpers = require('./helpers');
const ingressHelper = require('./ingress');

function apiDeleteTrigger(triggerName, namespace, triggerType) {
  const triggerApi = new CRD('apis/kubeless.io', 'v1beta1', namespace, triggerType);
  return triggerApi.delete(triggerName);
}

function removeTrigger(event, funcName, namespace, service, options) {
  let triggerPromise = new BbPromise((r) => r());
  switch (_.keys(event)[0]) {
    case 'http':
      // TODO: Rely on Kubeless httptrigger object when it support paths
      break;
    case 'trigger': {
      if (_.isEmpty(event.trigger)) {
        throw new Error('You should specify a topic for the trigger event');
      }
      options.log(`Deleting PubSub trigger ${funcName}-${event.trigger}`);

      // Defaults to Kafka
      let mqType = 'kafka';
      if (typeof event.trigger !== 'string') {
        if (_.isEmpty(event.trigger.queue)) {
          throw new Error(
            'You should specify a message queue type for the trigger event (i.e. kafka, nats)'
          );
        }
        mqType = event.trigger.queue;
      }

      triggerPromise = apiDeleteTrigger(
        helpers.escapeName(`${funcName}-${event.trigger}`),
        namespace,
        `${mqType}triggers`
      );
      break;
    }
    case 'schedule':
      if (_.isEmpty(event.schedule)) {
        throw new Error('You should specify a schedule for the trigger event');
      }
      options.log(`Deleting scheduled trigger for ${funcName}`);
      triggerPromise = apiDeleteTrigger(
        funcName,
        namespace,
        'cronjobtriggers'
      );
      break;
    default:
      throw new Error(`Event type ${event.type} is not supported`);
  }
  return triggerPromise;
}


function checkResult(res, name, errors, options) {
  if (res && res.code && res.code !== 200) {
    if (res.code === 404) {
      if (options.verbose) {
        options.log(`The element ${name} doesn't exist. Skipping removal.`);
      }
    } else {
      errors.push(
        `Unable to remove ${name}. Received:\n` +
        `  Code: ${res.code}\n` +
        `  Message: ${res.message}`);
    }
  }
}

function removeFunction(functions, service, options) {
  const opts = _.defaults({}, options, {
    namespace: 'default',
    verbose: false,
    log: console.log,
    apiExtensions: null,
  });
  const errors = [];
  let counter = 0;
  // Total number of elements to delete
  const elements = helpers.getDeployableItemsNumber(functions);
  return new BbPromise((resolve, reject) => {
    _.each(functions, (desc) => {
      opts.log(`Removing function: ${desc.id}...`);
      const namespace = desc.namespace || opts.namespace;
      const functionsApi = new CRD('apis/kubeless.io', 'v1beta1', namespace, 'functions');
      // Delete function
      functionsApi.delete(desc.id).catch((err) => {
        errors.push(
          `Unable to remove the function ${desc.id}. Received:\n` +
          `  Code: ${err.code}\n` +
          `  Message: ${err.message}`
        );
      }).then(res => {
        checkResult(res, desc.id, errors, { log: opts.log, verbose: opts.verbose });
        counter++;
        helpers.checkFinished(counter, elements, errors, resolve, reject, {
          onSuccess: () => ingressHelper.removeIngressRule(
            service,
            namespace,
            { verbose: options.verbose, log: options.log, apiExtensions: options.apiExtensions }
          ),
        });
      });
      _.each(desc.events, event => {
        removeTrigger(event, desc.id, namespace, service, opts).catch(err => {
          checkResult(err, desc.id, errors, { log: opts.log, verbose: opts.verbose });
        }).then((res) => {
          checkResult(res, desc.id, errors, { log: opts.log, verbose: opts.verbose });
          counter++;
          helpers.checkFinished(counter, elements, errors, resolve, reject, {
            onSuccess: () => ingressHelper.removeIngressRule(
              service,
              namespace,
              { verbose: options.verbose, log: options.log, apiExtensions: options.apiExtensions }
            ),
          });
        });
      });
    });
  });
}

module.exports = removeFunction;
