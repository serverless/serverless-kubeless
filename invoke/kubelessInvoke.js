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
const path = require('path');
const request = require('request');
const helpers = require('../lib/helpers');

class KubelessInvoke {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'invoke:invoke': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.invokeFunction)
        .then(this.log),
    };
  }

  getData() {
    let result = null;
    try {
      if (!_.isEmpty(this.options.data)) {
        try {
          // Try to parse data as JSON
          result = {
            body: JSON.parse(this.options.data),
            json: true,
          };
        } catch (e) {
          // Assume data is a string
          result = {
            body: this.options.data,
          };
        }
      } else if (this.options.path) {
        const absolutePath = path.isAbsolute(this.options.path) ?
          this.options.path :
          path.join(this.serverless.config.servicePath, this.options.path);
        if (!this.serverless.utils.fileExistsSync(absolutePath)) {
          throw new this.serverless.classes.Error('The file you provided does not exist.');
        }
        result = {
          body: this.serverless.utils.readFileSync(absolutePath),
          json: true,
        };
      }
    } catch (e) {
      throw new this.serverless.classes.Error(
        `Unable to parse data given in the arguments: \n${e.message}`
      );
    }
    return result;
  }

  validate() {
    // Parse data to ensure it has a correct format
    this.getData();
    const unsupportedOptions = ['stage', 'region', 'type'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    if (_.isUndefined(this.serverless.service.functions[this.options.function])) {
      throw new Error(
        `The function ${this.options.function} is not present in the current description`
      );
    }
    return BbPromise.resolve();
  }

  invokeFunction() {
    const f = this.options.function;
    this.serverless.cli.log(`Calling function: ${f}...`);
    const config = helpers.loadKubeConfig();
    const APIRootUrl = helpers.getKubernetesAPIURL(config);
    const namespace = this.serverless.service.functions[f].namespace ||
      this.serverless.service.provider.namespace ||
      helpers.getDefaultNamespace(config);
    const url = `${APIRootUrl}/api/v1/proxy/namespaces/${namespace}/services/${f}/`;
    const connectionOptions = Object.assign(
      helpers.getConnectionOptions(helpers.loadKubeConfig()),
      { url }
    );
    const requestData = this.getData();

    return new BbPromise((resolve, reject) => {
      const parseReponse = (err, response) => {
        if (err) {
          reject(new this.serverless.classes.Error(err.message, err.statusCode));
        } else {
          if (response.statusCode !== 200) {
            reject(new this.serverless.classes.Error(response.statusMessage, response.statusCode));
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
  log(response) {
    if (this.options.log) {
      console.log('--------------------------------------------------------------------');
      console.log(response.body);
    }
    return BbPromise.resolve();
  }
}

module.exports = KubelessInvoke;
