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
const serverless = require('./lib/serverless')();

const functionName = 'myFunction';

require('chai').use(chaiAsPromised);

function instantiateKubelessDeploy(handlerFile, depsFile, serverlessWithFunction, options) {
  const kubelessDeployFunction = new KubelessDeployFunction(
    serverlessWithFunction,
    _.defaults({ function: functionName, options })
  );
  // Mock call to getFunctionContent when retrieving the function code
  sinon.stub(kubelessDeployFunction, 'getFunctionContent')
    .withArgs(path.basename(handlerFile))
    .callsFake(() => ({ then: (f) => f(fs.readFileSync(handlerFile).toString()) }));
  // Mock call to getFunctionContent when retrieving the requirements text
  kubelessDeployFunction.getFunctionContent
    .withArgs(path.basename(depsFile))
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
    let handlerFile = null;
    let depsFile = null;
    let serverlessWithFunction = null;

    let kubelessDeployFunction = null;

    beforeEach(() => {
      cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
      config = mocks.kubeConfig(cwd);
      handlerFile = path.join(cwd, 'function.py');
      fs.writeFileSync(handlerFile, 'function code');
      depsFile = path.join(cwd, 'requirements.txt');
      setInterval(() => {
        clock.tick(2001);
      }, 100);
      clock = sinon.useFakeTimers();
      serverlessWithFunction = _.defaultsDeep({}, serverless, {
        config: {
          servicePath: cwd,
        },
        service: {
          functions: {},
        },
      });
      serverlessWithFunction.service.functions[functionName] = {
        handler: 'function.hello',
      };
      serverlessWithFunction.service.functions.otherFunction = {
        handler: 'function.hello',
      };
      kubelessDeployFunction = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithFunction
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: 'request',
        function: 'function code modified',
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      }, {
        existingFunctions: [{
          metadata: {
            name: functionName,
            labels: { function: functionName },
          },
          spec: {
            deps: 'request',
            function: 'function code',
            handler: serverlessWithFunction.service.functions[functionName].handler,
            runtime: serverlessWithFunction.service.provider.runtime,
            type: 'HTTP',
          },
        }],
      });
      nock(config.clusters[0].cluster.server)
        .patch(`/apis/k8s.io/v1/namespaces/default/functions/${functionName}`, {
          apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: 'myFunction', namespace: 'default' },
          spec: {
            deps: '',
            function: 'function code',
            handler: 'function.hello',
            runtime: 'python2.7',
            type: 'HTTP',
          },
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
          { myFunction: { handler: 'function.hello' } }
        );
      })
    ).to.be.fulfilled);
  });
});
