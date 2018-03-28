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
const KubelessDeploy = require('../deploy/kubelessDeploy');

class KubelessDeployFunction extends KubelessDeploy {
  constructor(serverless, options) {
    super(serverless, options);
    if (this.options.v) this.options.verbose = true;
    this.options.force = true;
    this.hooks = {
      'deploy:function:initialize': () => BbPromise.bind(this)
        .then(this.excludes),
      'deploy:function:packageFunction': () => this.serverless.pluginManager
        .spawn('package:function'),
      'deploy:function:deploy': () => BbPromise.bind(this)
      .then(this.validate)
      .then(this.deployFunction),
    };
  }

  deployFunction() {
    // Pick only the function that we are interested in
    this.serverless.service.functions = _.pick(
      this.serverless.service.functions,
      this.options.function
    );
    if (_.isEmpty(this.serverless.service.functions)) {
      throw new Error(
        `The function ${this.options.function} is not present in the current description`
      );
    }
    this.serverless.cli.log(`Redeploying ${this.options.function}...`);
    return super.deployFunction();
  }
}

module.exports = KubelessDeployFunction;
