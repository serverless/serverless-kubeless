'use strict';

const BbPromise = require('bluebird');
const fs = require('fs');
const Api = require('kubernetes-client');

class KubelessRemove {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'remove:remove': () => BbPromise.bind(this)
        .then(this.removeFunction)
    };
  }

  removeFunction() {
    this.serverless.cli.log(`Removing function: ${this.serverless.service.service}...`);

    var funcName = this.serverless.service.service

    var thirdPartyResources = new Api.ThirdPartyResources({
      url: process.env['K8SAPISERVER'],
      ca: fs.readFileSync(process.env['HOME'] + "/.minikube/ca.crt"),
      cert: fs.readFileSync(process.env['HOME'] + "/.minikube/apiserver.crt"),
      key: fs.readFileSync(process.env['HOME'] + "/.minikube/apiserver.key"),
      group: 'k8s.io',
    });

    thirdPartyResources.addResource('functions');
    // Delete function
    thirdPartyResources.ns.functions.delete(funcName, print)
  }
}

function print(err, result) {
  console.log(JSON.stringify(err || result, null, 2));
}

module.exports = KubelessRemove;
