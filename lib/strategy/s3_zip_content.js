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

const crypto = require('crypto');
const fs = require('fs');
const AWS = require('aws-sdk');
const BbPromise = require('bluebird');

class S3ZipContent {
  constructor(strategy, options) {
    this.strategy = strategy;
    this.options = options;
  }

  deploy(description, artifact) {
    return new BbPromise((resolve, reject) => {
      const shasum = crypto.createHash('sha256');
      const content = fs.readFileSync(artifact);
      shasum.update(content);

      AWS.config.update(this.options, true);
      const s3 = new AWS.S3();
      const Key = `${description.name}-${+(new Date())}.zip`;

      this.strategy.serverless.cli.log(`Uploading function ${description.name} as ${Key}`);

      return s3.putObject({
        Key,
        Bucket: this.options.bucket,
        Body: fs.readFileSync(artifact),
      }).promise()
        .then(() => {
          const r = new AWS.Request(s3, 'getObject', { Key, Bucket: this.options.bucket });
          s3.populateURI(r);
          resolve({
            content: `${r.httpRequest.endpoint.protocol}//${r.httpRequest.endpoint.host}/${Key}`,
            checksum: `sha256:${shasum.digest('hex')}`,
            contentType: 'url+zip',
          });
        }, reject);
    });
  }
}

module.exports = S3ZipContent;
