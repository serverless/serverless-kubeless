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

class Functions {
  constructor(options) {
    const opts = _.defaults({}, options, {
      namespace: 'default',
    });
    this.namespace = opts.namespace;
    const APIRootUrl = helpers.getKubernetesAPIURL(helpers.loadKubeConfig());
    const url = `${APIRootUrl}/apis/k8s.io/v1/namespaces/${opts.namespace}/functions/`;
    this.connectionOptions = Object.assign(
        helpers.getConnectionOptions(helpers.loadKubeConfig()),
        { url, json: true }
    );
  }
  get(callback) {
    const data = [];
    request.get(this.connectionOptions)
    .on('error', err => {
      callback(err);
    })
    .on('data', (d) => {
      data.push(d);
    })
    .on('end', () => {
      const res = Buffer.concat(data).toString();
      callback(null, JSON.parse(res));
    });
  }
  post(body, callback) {
    const data = [];
    request.post(_.assign(body, this.connectionOptions))
    .on('error', err => {
      callback(err);
    })
      .on('data', (d) => {
        data.push(d);
      })
      .on('end', () => {
        const res = Buffer.concat(data).toString();
        callback(null, JSON.parse(res));
      });
  }
  put(resourceID, body, callback) {
    const data = [];
    request.patch(_.assign({}, body, this.connectionOptions, {
      url: `${this.connectionOptions.url}${resourceID}`,
      headers: {
        'Content-Type': 'application/merge-patch+json',
      },
      json: true,
    }))
    .on('error', err => {
      callback(err);
    })
    .on('data', (d) => {
      data.push(d);
    })
    .on('end', () => {
      const res = Buffer.concat(data).toString();
      callback(null, JSON.parse(res));
    });
  }
  delete(resourceID, callback) {
    const data = [];
    request.delete(_.assign({}, this.connectionOptions, {
      url: `${this.connectionOptions.url}${resourceID}`,
    }))
      .on('error', err => {
        callback(err);
      })
      .on('data', (d) => {
        data.push(d);
      })
      .on('end', () => {
        const res = Buffer.concat(data).toString();
        callback(null, JSON.parse(res));
      });
  }
}

module.exports = Functions;
