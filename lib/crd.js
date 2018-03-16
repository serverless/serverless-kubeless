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
const helpers = require('./helpers');
const request = require('request');

class CRD {
  constructor(group, version, namespace, item) {
    this.namespace = namespace;
    const APIRootUrl = helpers.getKubernetesAPIURL(helpers.loadKubeConfig());
    const fullUrl = `${APIRootUrl}/${group}/${version}/namespaces/${namespace}/${item}/`;
    this.connectionOptions = Object.assign(
        helpers.getConnectionOptions(helpers.loadKubeConfig()),
        { url: fullUrl, json: true }
    );
  }
  getItem(id) {
    const data = [];
    return new BbPromise((resolve, reject) => {
      request.get(_.assign({}, this.connectionOptions, {
        url: `${this.connectionOptions.url}${id}`,
      }))
        .on('error', err => {
          reject(err);
        })
        .on('data', (d) => {
          data.push(d);
        })
        .on('end', () => {
          const res = Buffer.concat(data).toString();
          resolve(JSON.parse(res));
        });
    });
  }
  list() {
    const data = [];
    return new BbPromise((resolve, reject) => {
      request.get(this.connectionOptions)
        .on('error', err => {
          reject(err);
        })
        .on('data', (d) => {
          data.push(d);
        })
        .on('end', () => {
          const res = Buffer.concat(data).toString();
          resolve(JSON.parse(res));
        });
    });
  }
  post(body) {
    const data = [];
    return new Promise((resolve, reject) => {
      request.post(_.assign(body, this.connectionOptions))
        .on('error', err => {
          reject(err);
        })
        .on('data', (d) => {
          data.push(d);
        })
        .on('end', () => {
          const res = Buffer.concat(data).toString();
          resolve(JSON.parse(res));
        });
    });
  }
  put(resourceID, body) {
    const data = [];
    return new BbPromise((resolve, reject) => {
      request.patch(_.assign({}, body, this.connectionOptions, {
        url: `${this.connectionOptions.url}${resourceID}`,
        headers: {
          'Content-Type': 'application/merge-patch+json',
        },
      }))
        .on('error', err => {
          reject(err);
        })
        .on('data', (d) => {
          data.push(d);
        })
        .on('end', () => {
          const res = Buffer.concat(data).toString();
          resolve(JSON.parse(res));
        });
    });
  }
  delete(resourceID) {
    const data = [];
    return new BbPromise((resolve, reject) => {
      request.delete(_.assign({}, this.connectionOptions, {
        url: `${this.connectionOptions.url}${resourceID}`,
      }))
        .on('error', err => {
          reject(err);
        })
        .on('data', (d) => {
          data.push(d);
        })
        .on('end', () => {
          const res = Buffer.concat(data).toString();
          resolve(JSON.parse(res));
        });
    });
  }
}

module.exports = CRD;
