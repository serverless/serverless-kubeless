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
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const fs = require('fs');
const moment = require('moment');
const os = require('os');
const path = require('path');
const sinon = require('sinon');

const KubelessDeploy = require('../deploy/kubelessDeploy');
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
  const kubelessDeploy = new KubelessDeploy(serverlessWithFunction, options);
  // Mock call to getFunctionContent when retrieving the function code
  sinon.stub(kubelessDeploy, 'getFunctionContent')
    .withArgs(path.basename(handlerFile))
    .callsFake(() => ({ then: (f) => f('function code') }));
    // Mock call to getFunctionContent when retrieving the requirements text
  kubelessDeploy.getFunctionContent
    .withArgs(path.basename(depsFile))
    .callsFake(() => ({ catch: () => ({ then: (f) => f(null) }) }));
  return kubelessDeploy;
}

function mockThirdPartyResources(kubelessDeploy) {
  const thirdPartyResources = {
    namespaces: {
      namespace: 'default',
    },
    ns: {
      functions: {
        post: sinon.stub().callsFake((body, callback) => {
          callback(null, { statusCode: 200 });
        }),
      },
    },
    addResource: sinon.stub(),
  };
  sinon.stub(kubelessDeploy, 'getThirdPartyResources').returns(thirdPartyResources);
  return thirdPartyResources;
}

describe('KubelessDeploy', () => {
  describe('#constructor', () => {
    const options = { test: 1 };
    const kubelessDeploy = new KubelessDeploy(serverless, options);
    let validateStub = null;
    let deployStub = null;
    const stubHooks = (kbDeploy) => {
      validateStub = sinon.stub(kbDeploy, 'validate').returns(BbPromise.resolve());
      deployStub = sinon.stub(kbDeploy, 'deployFunction').returns(BbPromise.resolve());
    };
    const restoreHooks = (kbDeploy) => {
      kbDeploy.validate.restore();
      kbDeploy.deployFunction.restore();
    };
    beforeEach(() => {
      stubHooks(kubelessDeploy);
    });
    afterEach(() => {
      restoreHooks(kubelessDeploy);
    });
    it('should set the serverless instance', () => {
      expect(kubelessDeploy.serverless).to.be.eql(serverless);
    });
    it('should set options if provided', () => {
      expect(kubelessDeploy.options).to.be.eql(options);
    });
    it('should set a provider ', () => {
      expect(kubelessDeploy.provider).to.not.be.eql(undefined);
    });
    it('should have hooks', () => expect(kubelessDeploy.hooks).to.be.not.empty);
    it(
      'should run promise chain in order',
      () => kubelessDeploy.hooks['deploy:deploy']().then(() => {
        expect(validateStub.calledOnce).to.be.equal(true);
        expect(deployStub.calledAfter(validateStub)).to.be.equal(true);
      })
    );
  });
  describe('#validate', () => {
    it('prints a message if an unsupported option is given', () => {
      const kubelessDeploy = new KubelessDeploy(serverless, { region: 'us-east1' });
      sinon.stub(serverless.cli, 'log');
      try {
        expect(() => kubelessDeploy.validate()).to.not.throw();
        expect(serverless.cli.log.firstCall.args).to.be.eql(
          ['Warning: Option region is not supported for the kubeless plugin']
        );
      } finally {
        serverless.cli.log.restore();
      }
    });
  });
  describe('#deploy', () => {
    const cwd = path.join(os.tmpdir(), moment().valueOf().toString());
    const handlerFile = path.join(cwd, 'function.py');
    const depsFile = path.join(cwd, 'requirements.txt');
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
    let kubelessDeploy = null;
    let thirdPartyResources = null;

    before(() => {
      fs.mkdirSync(cwd);
      fs.writeFileSync(handlerFile, 'function code');
    });
    beforeEach(() => {
      kubelessDeploy = instantiateKubelessDeploy(handlerFile, depsFile, serverlessWithFunction);
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
    });
    after(() => {
      rm(cwd);
    });
    it('should deploy a function', () => {
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(thirdPartyResources.ns.functions.post.firstCall.args[0].body).to.be.eql(
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
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should skip a deployment if an error 409 is returned', () => {
      thirdPartyResources.ns.functions.post.callsFake((data, ff) => {
        ff({ code: 409 });
      });
      sinon.stub(serverlessWithFunction.cli, 'log');
      let result = null;
      try {
        result = expect( // eslint-disable-line no-unused-expressions
          kubelessDeploy.deployFunction()
        ).to.be.fulfilled;
        expect(serverlessWithFunction.cli.log.lastCall.args).to.be.eql(
          ['The function myFunction is already deployed. Remove it if you want to deploy it again.']
        );
      } finally {
        serverlessWithFunction.cli.log.restore();
      }
      return result;
    });
    it('should fail if a deployment returns an error code', () => {
      thirdPartyResources.ns.functions.post.callsFake((data, ff) => {
        ff({ code: 500, message: 'Internal server error' });
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.eventually.rejectedWith(
        'Found errors while deploying the given functions:\n' +
        'Unable to deploy the function myFunction. Received:\n' +
        '  Code: 500\n' +
        '  Message: Internal server error'
      );
    });
    it('should deploy the possible functions even if one of them fails', () => {
      const serverlessWithFunctions = _.defaultsDeep({}, serverless, {
        service: {
          functions: {
            myFunction1: {
              handler: 'function.hello',
            },
            myFunction2: {
              handler: 'function.hello',
            },
            myFunction3: {
              handler: 'function.hello',
            },
          },
        },
      });
      const functionsDeployed = [];
      kubelessDeploy = instantiateKubelessDeploy(handlerFile, depsFile, serverlessWithFunctions);
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      thirdPartyResources.ns.functions.post.onFirstCall().callsFake((data, ff) => {
        functionsDeployed.push(data.body.metadata.name);
        ff(null, { statusCode: 200 });
      });
      thirdPartyResources.ns.functions.post.onSecondCall().callsFake((data, ff) => {
        ff({ code: 500, message: 'Internal server error' });
      });
      thirdPartyResources.ns.functions.post.onThirdCall().callsFake((data, ff) => {
        functionsDeployed.push(data.body.metadata.name);
        ff(null, { statusCode: 200 });
      });
      const result = expect(
        kubelessDeploy.deployFunction()
      ).to.be.eventually.rejectedWith(
        'Found errors while deploying the given functions:\n' +
        'Unable to deploy the function myFunction2. Received:\n' +
        '  Code: 500\n' +
        '  Message: Internal server error'
      );
      expect(functionsDeployed).to.be.eql(['myFunction1', 'myFunction3']);
      return result;
    });
    it('should deploy a function using the given package', () => {
      kubelessDeploy = new KubelessDeploy(serverlessWithFunction, {
        package: path.join(cwd, 'package.zip'),
      });
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      fs.writeFileSync(path.join(path.join(cwd, 'package.zip')), '');
      sinon.stub(kubelessDeploy, 'loadZip').returns({
        then: (f) => f({
          file: () => ({
            async: () => ({
              then: (ff) => ff('different function content'),
              catch: () => ({ then: (ff) => ff(null) }),
            }),
          }),
        }),
      });
      const result = expect(kubelessDeploy.deployFunction()).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(thirdPartyResources.ns.functions.post.firstCall.args[0].body).to.be.eql(
        { apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: 'myFunction', namespace: 'default' },
          spec:
          { deps: '',
            function: 'different function content',
            handler: 'function.hello',
            runtime: 'python2.7',
            topic: '',
            type: 'HTTP' } }
              );
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should deploy a function with requirements', () => {
      kubelessDeploy = new KubelessDeploy(serverlessWithFunction);
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      fs.writeFileSync(depsFile, 'request');
      const result = expect(
      kubelessDeploy.deployFunction().then(() => {
        expect(
          thirdPartyResources.ns.functions.post.calledOnce
        ).to.be.eql(true);
        expect(
          thirdPartyResources.ns.functions.post.firstCall.args[0].body.spec.deps
        ).to.be.eql('request');
        fs.unlinkSync(path.join(cwd, 'requirements.txt'), 'request');
      })
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with requirements using the given package', () => {
      kubelessDeploy = new KubelessDeploy(serverlessWithFunction, {
        package: path.join(cwd, 'package.zip'),
      });
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      fs.writeFileSync(path.join(path.join(cwd, 'package.zip')), '');
      sinon.stub(kubelessDeploy, 'loadZip').returns({
        then: (f) => f({
          file: () => ({
            async: () => ({
              then: (ff) => ff('different function content'),
              catch: () => ({ then: (ff) => ff('request') }),
            }),
          }),
        }),
      });
      const result = expect(kubelessDeploy.deployFunction()).to.be.fulfilled;
      expect(
        thirdPartyResources.ns.functions.post.calledOnce
      ).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.spec.deps
      ).to.be.eql('request');
      return result;
    });
  });
});
