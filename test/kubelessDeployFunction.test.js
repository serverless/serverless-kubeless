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
const os = require('os');
const path = require('path');
const rm = require('./lib/rm');
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
  sinon.stub(kubelessDeployFunction, 'waitForDeployment');
  return kubelessDeployFunction;
}

describe('KubelessDeployFunction', () => {
  describe('#deploy', () => {
    let cwd = null;
    let handlerFile = null;
    let depsFile = null;
    const serverlessWithFunction = _.defaultsDeep({}, serverless, {
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

    let kubelessDeployFunction = null;
    let thirdPartyResources = null;

    before(() => {
      cwd = mocks.kubeConfig();
    });
    beforeEach(() => {
      handlerFile = path.join(cwd, 'function.py');
      fs.writeFileSync(handlerFile, 'function code');
      depsFile = path.join(cwd, 'requirements.txt');
      kubelessDeployFunction = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithFunction
      );
      thirdPartyResources = mocks.thirdPartyResources(kubelessDeployFunction);
    });
    after(() => {
      mocks.restoreKubeConfig(cwd);
    });
    it('should deploy the chosen function', () => {
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeployFunction.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.metadata.name
      ).to.be.eql(functionName);
      return result;
    });
    it('should redeploy only the chosen function', () => {
      kubelessDeployFunction.getThirdPartyResources().ns.functions.get.callsFake((ff) => {
        ff(null, {
          items: [{
            metadata: {
              name: functionName,
              labels: { function: functionName },
              creationTimestamp: moment(),
            },
            status: {
              containerStatuses: [{
                ready: true,
                restartCount: 0,
                state: 'Ready',
              }],
            },
            spec: {
              deps: '',
              function: 'previous function code',
              handler: 'function.hello',
              runtime: 'python2.7',
              type: 'HTTP',
            },
          }],
        });
      });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeployFunction.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions().put.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions().put.firstCall.args[0].body.metadata.name
      ).to.be.eql(functionName);
      return result;
    });
  });
});
