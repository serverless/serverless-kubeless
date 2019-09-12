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

const fs = require('fs');
const os = require('os');
const path = require('path');
const moment = require('moment');
const expect = require('chai').expect;
const Strategy = require('../lib/strategy');
const Base64ZipContent = require('../lib/strategy/base64_zip_content');
const serverlessFact = require('./lib/serverless');

describe('KubelessDeployStrategy', () => {
  it('default strategy is Base64ZipContent', () => {
    const serverless = serverlessFact();
    const strategy = new Strategy(serverless);
    const product = strategy.factory();

    expect(Object.getPrototypeOf(product).constructor).to.equal(Base64ZipContent);
  });

  describe('Base64ZipContent', () => {
    describe('#deploy', () => {
      const functionRawText = 'function code';
      const functionChecksum =
          'sha256:ce182d715b42b27f1babf8b4196cd4f8c900ca6593a4293d455d1e5e2296ebee';

      let pkgPath;

      beforeEach(() => {
        pkgPath = `${path.join(os.tmpdir(), moment().valueOf().toString())}.zip`;
        fs.writeFileSync(pkgPath, functionRawText);
      });

      afterEach(() => {
        fs.unlinkSync(pkgPath);
      });

      it('produces valid deploy options', () => {
        const serverless = serverlessFact();
        const strategy = new Strategy(serverless);
        const fixture = new Base64ZipContent(strategy);

        const result = fixture.deploy({}, pkgPath);

        expect(result.contentType).to.equal('base64+zip');
        expect(result.content).to.equal(Buffer.from(functionRawText).toString('base64'));
        expect(result.checksum).to.equal(functionChecksum);
      });
    });
  });
});
