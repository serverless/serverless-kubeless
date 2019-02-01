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
const helpers = require('./helpers');
const request = require('request');

class Config {
  constructor(options) {
    const opts = _.defaults({}, options, {
      namespace: 'kubeless',
    });
    this.namespace = opts.namespace;
    const APIRootUrl = helpers.getKubernetesAPIURL(helpers.loadKubeConfig());
    const url = `${APIRootUrl}/api/v1/namespaces/${opts.namespace}/configmaps/kubeless-config`;
    this.connectionOptions = Object.assign(
            helpers.getConnectionOptions(helpers.loadKubeConfig()),
            { url, json: true }
        );
    this.configMag = {};
  }
  init() {
    const data = [];
    return new Promise((resolve, reject) => {
      request.get(this.connectionOptions)
            .on('error', err => {
              reject(err);
            })
            .on('data', (d) => {
              data.push(d);
            })
            .on('end', () => {
              const res = JSON.parse(Buffer.concat(data).toString());
              if (res.code && res.code !== 200) {
                reject(new Error(
                  `Request returned: ${res.code} - ${res.message}` +
                  `\n  Response: ${JSON.stringify(res)}\n` +
                  `${res.code === 401 && '  Check if your token has expired.'}`
                  ));
              } else {
                this.configMag = res;
                resolve();
              }
            });
    });
  }
  get(key, opt) {
    if (opt && opt.parse) {
      return JSON.parse(this.configMag.data[key]);
    }
    return this.configMag.data[key];
  }
}

module.exports = Config;
