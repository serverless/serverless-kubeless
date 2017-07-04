'use strict';

const BbPromise = require('bluebird');
const Api = require('kubernetes-client');
const helpers = require('../lib/helpers');

class KubelessDeploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'deploy:deploy': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.deployFunction),
    };
  }

  validate() {
    helpers.validateEnv();
    return BbPromise.resolve();
  }

  deployFunction() {
    const f = this.serverless.service.service;
    this.serverless.cli.log(`Deploying function: ${f}...`);
    const funcs = {
      apiVersion: 'k8s.io/v1',
      kind: 'Function',
      metadata: {
        name: this.serverless.service.service,
        namespace: 'default',
      },
      spec: {
        deps: '',
        function: this.serverless.utils.readFileSync(
          `${this.serverless.service.functions[f].handler.toString().split('.')[0]}.py`
        ),
        handler: this.serverless.service.functions[f].handler,
        runtime: this.serverless.service.provider.runtime,
        topic: '',
        type: 'HTTP',
      },
    };

    const thirdPartyResources = new Api.ThirdPartyResources(
      Object.assign(helpers.getMinikubeCredentials(), {
        url: process.env.KUBE_API_URL,
        group: 'k8s.io',
      })
    );

    thirdPartyResources.addResource('functions');
    // Create function
    thirdPartyResources.ns.functions.post({ body: funcs }, helpers.print);
    return BbPromise.resolve();
  }
}

module.exports = KubelessDeploy;
