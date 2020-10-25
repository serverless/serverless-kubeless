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
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const fs = require('fs');
const mocks = require('./lib/mocks');
const moment = require('moment');
const nock = require('nock');
const os = require('os');
const path = require('path');
const sinon = require('sinon');

const KubelessDeployFunction = require('../deployFunction/kubelessDeployFunction');
const serverlessFact = require('./lib/serverless');

let serverless = serverlessFact();

const functionName = 'myFunction';

require('chai').use(chaiAsPromised);

function instantiateKubelessDeploy(zipFile, depsFile, serverlessWithFunction, options) {
  const kubelessDeployFunction = new KubelessDeployFunction(
    serverlessWithFunction,
    _.defaults({ function: functionName, options })
  );
  // Mock call to getFunctionContent when retrieving the function code
  sinon.stub(kubelessDeployFunction, 'getFileContent');
  // Mock call to getFunctionContent when retrieving the requirements text
  kubelessDeployFunction.getFileContent
    .withArgs(zipFile, path.basename(depsFile))
    .callsFake(() => ({ catch: () => ({ then: (f) => {
      if (fs.existsSync(depsFile)) {
        return f(fs.readFileSync(depsFile).toString());
      }
      return f(null);
    } }) })
  );
  return kubelessDeployFunction;
}

describe('KubelessDeployFunction', () => {
  describe('#deploy', () => {
    let cwd = null;
    let clock = null;
    let config = null;
    let pkgFile = null;
    let depsFile = null;
    let serverlessWithFunction = null;
    const functionRawText = 'function code';
    const functionChecksum =
      'sha256:ce182d715b42b27f1babf8b4196cd4f8c900ca6593a4293d455d1e5e2296ebee';
    const functionText = Buffer.from(functionRawText).toString('base64');

    let kubelessDeployFunction = null;
    let defaultFuncSpec = null;

    beforeEach(() => {
      serverless = serverlessFact();
      cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
      config = mocks.kubeConfig(cwd);
      pkgFile = path.join(cwd, 'function.zip');
      fs.writeFileSync(pkgFile, functionRawText);
      depsFile = path.join(cwd, 'requirements.txt');
      setInterval(() => {
        clock.tick(2001);
      }, 100);
      clock = sinon.useFakeTimers();
      serverlessWithFunction = _.defaultsDeep({}, serverless, {
        config: {
          servicePath: cwd,
          serverless: {
            service: {
              artifact: pkgFile,
            },
          },
        },
        service: {
          functions: {},
        },
      });
      serverlessWithFunction.service.functions[functionName] = {
        handler: 'function.hello',
        package: {},
      };
      serverlessWithFunction.service.functions.otherFunction = {
        handler: 'function.hello',
        package: {},
      };
      kubelessDeployFunction = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithFunction
      );
      defaultFuncSpec = (modif) => _.assign({
        deps: '',
        function: functionText,
        checksum: functionChecksum,
        'function-content-type': 'base64+zip',
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        timeout: '180',
        service: {
          ports: [{ name: 'http-function-port', port: 8080, protocol: 'TCP', targetPort: 8080 }],
          selector: { function: functionName },
          type: 'ClusterIP',
        },
      }, modif);
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec(), {
          functionExists: true,
        });
      nock(config.clusters[0].cluster.server)
        .patch(`/apis/kubeless.io/v1beta1/namespaces/default/functions/${functionName}`, {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'Function',
          metadata: {
            name: functionName,
            namespace: 'default',
            labels: { 'created-by': 'kubeless', function: functionName },
            annotations: {},
          },
          spec: defaultFuncSpec(),
        })
        .reply(200, '{"message": "OK"}');
    });
    afterEach(() => {
      mocks.restoreKubeConfig(cwd);
      nock.cleanAll();
      clock.restore();
    });
    it('should deploy the chosen function', () => expect(
        kubelessDeployFunction.deployFunction()
      ).to.be.fulfilled);
    it('should redeploy only the chosen function', () => expect(
      kubelessDeployFunction.deployFunction().then(() => {
        expect(kubelessDeployFunction.serverless.service.functions).to.be.eql(
          { myFunction: { handler: 'function.hello', package: {} } }
        );
      })
    ).to.be.fulfilled);
  });
});
