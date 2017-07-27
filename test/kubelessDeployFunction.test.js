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
const moment = require('moment');
const os = require('os');
const path = require('path');
const sinon = require('sinon');

const KubelessDeployFunction = require('../deployFunction/kubelessDeployFunction');
const serverless = require('./lib/serverless');

require('chai').use(chaiAsPromised);

function rm(p) {
  if (fs.existsSync(p)) {
    fs.readdirSync(p).forEach((file) => {
      const curPath = `${p}/${file}`;
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        rm(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(p);
  }
}

function instantiateKubelessDeploy(handlerFile, depsFile, serverlessWithFunction, options) {
  const kubelessDeployFunction = new KubelessDeployFunction(
    serverlessWithFunction,
    _.defaults({ function: 'myFunction', options })
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
function mockPutRequest(kubelessDeploy) {
  const put = sinon.stub().callsFake((body, callback) => {
    callback(null, { statusCode: 200 });
  });
  const thirdPartyResources = {
    namespaces: {
      namespace: 'default',
    },
    ns: {
      functions: () => ({
        put,
      }),
    },
    addResource: sinon.stub(),
  };
  sinon.stub(kubelessDeploy, 'getThirdPartyResources').returns(thirdPartyResources);
  return put;
}

describe('KubelessDeploy', () => {
  describe('#deploy', () => {
    const cwd = path.join(os.tmpdir(), moment().valueOf().toString());
    let handlerFile = null;
    let depsFile = null;
    const serverlessWithFunction = _.defaultsDeep({}, serverless, {
      config: {
        servicePath: cwd,
      },
      service: {
        functions: {
          myFunction: {
            handler: 'function.hello',
          },
        },
      },
    });
    let kubelessDeployFunction = null;
    let put = null;

    before(() => {
      fs.mkdirSync(cwd);
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
      put = mockPutRequest(kubelessDeployFunction);
    });
    after(() => {
      rm(cwd);
    });
    it('should redeploy a function', () => {
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeployFunction.deployFunction()
      ).to.be.fulfilled;

      expect(put.calledOnce).to.be.eql(true);
      expect(put.firstCall.args[0].body).to.be.eql(
        { apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: 'myFunction', namespace: 'default' },
          spec:
          { deps: '',
            function: 'function code',
            handler: 'function.hello',
            runtime: 'python2.7',
            topic: '',
            type: 'HTTP' } }
      );
      expect(put.firstCall.args[1]).to.be.a('function');
      return result;
    });
    it('should fail if a deployment returns an error code', () => {
      put.callsFake((data, ff) => {
        ff({ code: 500, message: 'Internal server error' });
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeployFunction.deployFunction()
      ).to.be.eventually.rejectedWith(
        'Found errors while deploying the given functions:\n' +
        'Error: Unable to update the function myFunction. Received:\n' +
        '  Code: 500\n' +
        '  Message: Internal server error'
      );
    });
    it('should redeploy only the chosen function', () => {
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeployFunction.deployFunction()
      ).to.be.fulfilled;

      expect(put.calledOnce).to.be.eql(true);
      expect(put.firstCall.args[0].body.metadata.name).to.be.eql('myFunction');
      return result;
    });
  });
});
