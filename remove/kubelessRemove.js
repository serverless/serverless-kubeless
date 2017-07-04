'use strict';

const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const helpers = require('../lib/helpers');

class KubelessRemove {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('google');

    this.hooks = {
      'remove:remove': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.removeFunction),
    };
  }

  validate() {
    helpers.validateEnv();
    return BbPromise.resolve();
  }

  removeFunction() {
    const f = this.serverless.service.service;
    this.serverless.cli.log(`Removing function: ${f}...`);

    const thirdPartyResources = new Api.ThirdPartyResources(
      Object.assign(helpers.getMinikubeCredentials(), {
        url: process.env.KUBE_API_URL,
        group: 'k8s.io',
      })
    );

    thirdPartyResources.addResource('functions');
    // Delete function
    thirdPartyResources.ns.functions.delete(f, helpers.print);
    return BbPromise.resolve();
  }
}

module.exports = KubelessRemove;
