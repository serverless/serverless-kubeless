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
module.exports = {
  validateEnv,
  getMinikubeCredentials,
  print,
};
