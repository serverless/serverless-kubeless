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
const Config = require('../lib/config');
const crypto = require('crypto');
const deploy = require('../lib/deploy');
const fs = require('fs');
const helpers = require('../lib/helpers');
const JSZip = require('jszip');

class KubelessDeploy {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider('kubeless');

    this.hooks = {
      'before:package:createDeploymentArtifacts': () => BbPromise.bind(this)
        .then(this.excludes),
      'deploy:deploy': () => BbPromise.bind(this)
        .then(this.validate)
        .then(this.deployFunction),
    };
    // Store the result of loading the Zip file
    this.loadZip = _.memoize(JSZip.loadAsync);
  }

  excludes() {
    const exclude = this.serverless.service.package.exclude || [];
    exclude.push('node_modules/**');
    this.serverless.service.package.exclude = exclude;
  }

  validate() {
    const unsupportedOptions = ['stage', 'region'];
    helpers.warnUnsupportedOptions(
      unsupportedOptions,
      this.options,
      this.serverless.cli.log.bind(this.serverless.cli)
    );
    return BbPromise.resolve();
  }

  getFileContent(zipFile, relativePath) {
    return this.loadZip(fs.readFileSync(zipFile)).then(
      (zip) => zip.file(relativePath).async('string')
    );
  }

  checkSize(pkg) {
    const stat = fs.statSync(pkg);
    // Maximum size for a etcd entry is 1 MB and right now Kubeless is storing files as
    // etcd entries
    const oneMB = 1024 * 1024;
    if (stat.size > oneMB) {
      this.serverless.cli.log(
        `WARNING! Function zip file is ${Math.round(stat.size / oneMB)}MB. ` +
        'The maximum size allowed is 1MB: please use package.exclude directives to include ' +
        'only the required files'
      );
    }
  }

  deployFunction() {
    const runtime = this.serverless.service.provider.runtime;
    const populatedFunctions = [];
    const kubelessConfig = new Config();
    return new BbPromise((resolve, reject) => {
      kubelessConfig.init().then(() => {
        _.each(this.serverless.service.functions, (description, name) => {
          const pkg = this.options.package ||
            this.serverless.service.package.path ||
            description.package.artifact ||
            this.serverless.config.serverless.service.artifact;
          this.checkSize(pkg);
          const s = fs.createReadStream(pkg);
          const shasum = crypto.createHash('sha256');
          let functionContent = '';
          s.on('error', (err) => reject(err));
          s.on('data', (data) => {
            shasum.update(data);
            functionContent += data.toString('base64');
          });
          s.on('end', () => {
            if (description.handler) {
              const depFile = helpers.getRuntimeDepfile(runtime, kubelessConfig);
              this.getFileContent(pkg, depFile)
                .catch(() => {
                  // No requirements found
                })
                .then((requirementsContent) => {
                  populatedFunctions.push(
                    _.assign({}, description, {
                      id: name,
                      content: functionContent,
                      checksum: `sha256:${shasum.digest('hex')}`,
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
            } else {
              populatedFunctions.push(_.assign({}, description, { id: name }));
              if (populatedFunctions.length === _.keys(this.serverless.service.functions).length) {
                resolve();
              }
            }
          });
        });
      });
    }).then(() => deploy(
      populatedFunctions,
      runtime,
      this.serverless.service.service,
      {
        namespace: this.serverless.service.provider.namespace,
        hostname: this.serverless.service.provider.hostname,
        defaultDNSResolution: this.serverless.service.provider.defaultDNSResolution,
        ingress: this.serverless.service.provider.ingress,
        cpu: this.serverless.service.provider.cpu,
        memorySize: this.serverless.service.provider.memorySize,
        force: this.options.force,
        verbose: this.options.verbose,
        log: this.serverless.cli.log.bind(this.serverless.cli),
        timeout: this.serverless.service.provider.timeout,
        contentType: 'base64+zip',
      }
    ));
  }
}

module.exports = KubelessDeploy;
