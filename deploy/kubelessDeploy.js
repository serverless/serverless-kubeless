'use strict';

const BbPromise = require('bluebird');
const fs = require('fs');
const Api = require('kubernetes-client');

class KubelessDeploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'deploy:deploy': () => BbPromise.bind(this)
        .then(this.deployFunction)
    };
  }

  deployFunction() {
    this.serverless.cli.log(`Deploying function: ${this.serverless.service.service}...`);

    var funcs = {
      apiVersion: `k8s.io/v1`,
      kind: 'Function',
      metadata: {
        name: this.serverless.service.service,
        namespace: 'default',
      },
      spec: {
        deps: '',
        function: fs.readFileSync(this.serverless.service.functions.hello.handler.toString().split(".")[0] + ".py", 'utf8'),
        handler: this.serverless.service.functions.hello.handler,
        runtime: this.serverless.service.provider.runtime,
        topic: '',
        type: 'HTTP',
      },
    };

    var thirdPartyResources = new Api.ThirdPartyResources({
      url: process.env['K8SAPISERVER'],
      ca: fs.readFileSync(process.env['HOME'] + "/.minikube/ca.crt"),
      cert: fs.readFileSync(process.env['HOME'] + "/.minikube/apiserver.crt"),
      key: fs.readFileSync(process.env['HOME'] + "/.minikube/apiserver.key"),
      group: 'k8s.io',
    });

    thirdPartyResources.addResource('functions');
    // Create function
    thirdPartyResources.ns.functions.post({body: funcs}, print)
  }
}

function print(err, result) {
  console.log(JSON.stringify(err || result, null, 2));
}

module.exports = KubelessDeploy;
