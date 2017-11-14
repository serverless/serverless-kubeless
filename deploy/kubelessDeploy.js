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
const deploy = require('../lib/deploy');
const fs = require('fs');
const helpers = require('../lib/helpers');
const JSZip = require('jszip');
const path = require('path');

class KubelessDeploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('kubeless');

    this.hooks = {
      'deploy:deploy': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.deployFunction),
    };
    // Store the result of loading the Zip file
    this.loadZip = _.memoize(JSZip.loadAsync);
  }

  validate() {
    const unsupportedOptions = ['stage', 'region'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    // Check that functions don't have more than one event source
    // since it is not supported yet
    _.each(this.serverless.service.functions, f => {
      if (f.events && f.events.length > 1) {
        throw new Error('It is not supported to have more than one event source yet');
      }
    });
    return BbPromise.resolve();
  }

  getFunctionContent(relativePath) {
    const pkg = this.options.package ||
      this.serverless.service.package.path;
    let resultPromise = null;
    if (pkg) {
      resultPromise = this.loadZip(fs.readFileSync(pkg)).then(
        (zip) => zip.file(relativePath).async('string')
      );
    } else {
      resultPromise = new BbPromise((resolve, reject) => {
        fs.readFile(
          path.join(this.serverless.config.servicePath || '.', relativePath),
          (err, d) => {
            if (err) {
              reject(err);
            } else {
              resolve(d.toString());
            }
          });
      });
    }
    return resultPromise;
  }

  deployFunction() {
    const runtime = this.serverless.service.provider.runtime;
    const populatedFunctions = [];
    return new BbPromise((resolve) => {
      _.each(this.serverless.service.functions, (description, name) => {
        if (description.handler) {
          const files = helpers.getRuntimeFilenames(runtime, description.handler);
          this.getFunctionContent(files.handler)
            .then(functionContent => {
              this.getFunctionContent(files.deps)
                .catch(() => {
                  // No requirements found
                })
                .then((requirementsContent) => {
                  populatedFunctions.push(
                    _.assign({}, description, {
                      id: name,
                      text: functionContent,
                      deps: requirementsContent,
                      image: description.image || this.serverless.service.provider.image,
                      events: _.map(description.events, (event) => {
                        const type = _.keys(event)[0];
                        if (type === 'trigger') {
                          return _.assign({ type }, { trigger: event[type] });
                        } else if (type === 'schedule') {
                          return _.assign({ type }, { schedule: event[type] });
                        }
                        return _.assign({ type }, event[type]);
                      }),
                    })
                  );
                  if (
                    populatedFunctions.length ===
                    _.keys(this.serverless.service.functions).length
                  ) {
                    resolve();
                  }
                });
            });
        } else {
          populatedFunctions.push(_.assign({}, description, { id: name }));
          if (populatedFunctions.length === _.keys(this.serverless.service.functions).length) {
            resolve();
          }
        }
      });
    }).then(() => deploy(
      populatedFunctions,
      runtime,
      {
        namespace: this.serverless.service.provider.namespace,
        hostname: this.serverless.service.provider.hostname,
        memorySize: this.serverless.service.provider.memorySize,
        force: this.options.force,
        verbose: this.options.verbose,
        log: this.serverless.cli.log.bind(this.serverless.cli),
      }
    ));
  }
}

module.exports = KubelessDeploy;
