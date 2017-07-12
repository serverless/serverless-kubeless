'use strict';

const _ = require('lodash');
const JSZip = require('jszip');
const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const helpers = require('../lib/helpers');
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

describe('KubelessDeploy', () => {
  const previousEnv = _.clone(process.env);
  const kubeApiURL = 'http://1.2.3.4:4433';
  beforeEach(() => {
    process.env.KUBE_API_URL = kubeApiURL;
    sinon.stub(helpers, 'getMinikubeCredentials').returns({
      cert: 'cert',
      ca: 'ca',
      key: 'key',
    });
  });
  afterEach(() => {
    process.env = previousEnv;
    helpers.getMinikubeCredentials.restore();
  });
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
    it('throws an error if the variable KUBE_API_URL is not set', () => {
      const kubelessDeploy = new KubelessDeploy(serverless);
      delete process.env.KUBE_API_URL;
      expect(() => kubelessDeploy.validate()).to.throw(
        'Please specify the Kubernetes API server IP as the environment variable KUBE_API_URL'
      );
    });
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
    let kubelessDeploy = new KubelessDeploy(serverlessWithFunction);
    sinon.stub(kubelessDeploy, 'getFunctionContent').returns({
      then: (f) => f('function code'),
    });

    before(() => {
      fs.mkdirSync(cwd);
      fs.writeFileSync(path.join(cwd, 'function.py'), 'function code');
    });
    beforeEach(() => {
      sinon.stub(Api.ThirdPartyResources.prototype, 'post');
      Api.ThirdPartyResources.prototype.post.callsFake((data, ff) => {
        ff(null, { statusCode: 200 });
      });
    });
    afterEach(() => {
      Api.ThirdPartyResources.prototype.post.restore();
    });
    after(() => {
      rm(cwd);
    });
    it('should deploy a function', () => {
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(Api.ThirdPartyResources.prototype.post.calledOnce).to.be.eql(true);
      expect(Api.ThirdPartyResources.prototype.post.firstCall.args[0].body).to.be.eql(
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
      expect(Api.ThirdPartyResources.prototype.post.firstCall.args[1]).to.be.a('function');
      return result;
    });
    it('should skip a deployment if an error 409 is returned', () => {
      Api.ThirdPartyResources.prototype.post.callsFake((data, ff) => {
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
      Api.ThirdPartyResources.prototype.post.callsFake((data, ff) => {
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
      Api.ThirdPartyResources.prototype.post.onFirstCall().callsFake((data, ff) => {
        functionsDeployed.push(data.body.metadata.name);
        ff(null, { statusCode: 200 });
      });
      Api.ThirdPartyResources.prototype.post.onSecondCall().callsFake((data, ff) => {
        ff({ code: 500, message: 'Internal server error' });
      });
      Api.ThirdPartyResources.prototype.post.onThirdCall().callsFake((data, ff) => {
        functionsDeployed.push(data.body.metadata.name);
        ff(null, { statusCode: 200 });
      });
      kubelessDeploy = new KubelessDeploy(serverlessWithFunctions);
      sinon.stub(kubelessDeploy, 'getFunctionContent').returns({
        then: (f) => f('function code'),
      });
      const result = expect( // eslint-disable-line no-unused-expressions
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
      fs.writeFileSync(path.join(path.join(cwd, 'package.zip')), '');
      sinon.stub(JSZip, 'loadAsync').returns({
        then: (f) => f({
          file: () => ({
            async: () => ({
              then: (ff) => ff('different function content'),
            }),
          }),
        }),
      });
      let result = null;
      try {
        result = expect(kubelessDeploy.deployFunction()).to.be.fulfilled;
        expect(Api.ThirdPartyResources.prototype.post.calledOnce).to.be.eql(true);
        expect(Api.ThirdPartyResources.prototype.post.firstCall.args[0].body).to.be.eql(
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
        expect(Api.ThirdPartyResources.prototype.post.firstCall.args[1]).to.be.a('function');
      } finally {
        JSZip.loadAsync.restore();
      }
      return result;
    });
  });
});
