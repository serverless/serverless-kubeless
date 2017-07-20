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

module.exports = function (config) {
  return _.defaults({}, config, {
    apiVersion: 'v1',
    'current-context': 'cluster-id',
    clusters: [
      {
        cluster: {
          'certificate-authority-data': 'LS0tLS1',
          server: 'http://1.2.3.4:4433',
        },
        name: 'cluster-name',
      },
    ],
    contexts: [
      {
        context: {
          cluster: 'cluster-name',
          user: 'cluster-user',
        },
        name: 'cluster-id',
      },
    ],
    users: [
      {
        name: 'cluster-user',
        user: {
          username: 'admin',
          password: 'password1234',
        },
      },
    ],
  });
};
