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
const fs = require('fs');
const path = require('path');

function print(err, result) {
  console.log(JSON.stringify(err || result, null, 2));
}

function validateEnv() {
  if (_.isEmpty(process.env.KUBE_API_URL)) {
    throw new Error(
      'Please specify the Kubernetes API server IP as the environment variable KUBE_API_URL'
    );
  }
}

function getMinikubeCredentials() {
  return {
    cert: fs.readFileSync(path.join(process.env.HOME, '.minikube/apiserver.crt')),
    ca: fs.readFileSync(path.join(process.env.HOME, '.minikube/ca.crt')),
    key: fs.readFileSync(path.join(process.env.HOME, '.minikube/apiserver.key')),
  };
}

function warnUnsupportedOptions(unsupportedOptions, definedOptions, logFunction) {
  unsupportedOptions.forEach((opt) => {
    if (!_.isUndefined(definedOptions[opt])) {
      logFunction(`Warning: Option ${opt} is not supported for the kubeless plugin`);
    }
  });
}

module.exports = {
  validateEnv,
  getMinikubeCredentials,
  print,
  warnUnsupportedOptions,
};
