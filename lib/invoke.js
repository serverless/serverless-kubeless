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
const fs = require('fs');
const path = require('path');
const request = require('request');
const helpers = require('../lib/helpers');

function getData(data, options) {
  const opts = _.defaults({}, options, {
    path: null,
  });
  let result = null;
  try {
    if (!_.isEmpty(data)) {
      if (_.isPlainObject(data)) {
        result = data;
      } else {
        try {
          // Try to parse data as JSON
          result = {
            body: JSON.parse(data),
            json: true,
          };
        } catch (e) {
          // Assume data is a string
          result = {
            body: data,
          };
        }
      }
    } else if (opts.path) {
      if (!path.isAbsolute(opts.path)) {
        throw new Error('Data path should be absolute');
      }
      if (!fs.existsSync(opts.path)) {
        throw new Error('The file you provided does not exist.');
      }
      result = {
        body: fs.readFileSync(opts.path, 'utf-8'),
        json: true,
      };
    }
  } catch (e) {
    throw new Error(
        `Unable to parse data given in the arguments: \n${e.message}`
    );
  }
  return result;
}

function invoke(func, data, funcsDesc, options) {
  const opts = _.defaults({}, options, {
    namespace: null,
    path: null,
  });
  const config = helpers.loadKubeConfig();
  const APIRootUrl = helpers.getKubernetesAPIURL(config);
  const desc = _.find(funcsDesc, d => d.id === func);
  const namespace = desc.namespace ||
        opts.namespace ||
        helpers.getDefaultNamespace(config);
  const url = `${APIRootUrl}/api/v1/proxy/namespaces/${namespace}/services/${func}/`;
  const connectionOptions = Object.assign(
        helpers.getConnectionOptions(helpers.loadKubeConfig()),
        { url }
    );
  const requestData = getData(data, {
    path: opts.path,
  });
  if (desc.sequence) {
    let promise = null;
    _.each(desc.sequence.slice(), sequenceFunction => {
      if (promise) {
        promise = promise.then(
          result => invoke(sequenceFunction, result.body, funcsDesc, opts)
        );
      } else {
        promise = invoke(sequenceFunction, requestData, funcsDesc, opts);
      }
    });
    return new BbPromise((resolve, reject) => promise.then(
        response => resolve(response),
        err => reject(err)
    ));
  }
  return new BbPromise((resolve, reject) => {
    const parseReponse = (err, response) => {
      if (err) {
        reject(new Error(err.message));
      } else {
        if (response.statusCode !== 200) {
          reject(new Error(response.statusMessage));
        }
        resolve(response);
      }
    };
    if (_.isEmpty(requestData)) {
      // There is no data to send, sending a GET request
      request.get(connectionOptions, parseReponse);
    } else {
      // Sending request data with a POST
      request.post(
        Object.assign(
          connectionOptions,
          requestData
        ),
        parseReponse
      );
    }
  });
}

module.exports = invoke;
