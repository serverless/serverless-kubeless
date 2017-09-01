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
const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const fs = require('fs');
const helpers = require('../lib/helpers');
const moment = require('moment');
const os = require('os');
const path = require('path');
const sinon = require('sinon');

const KubelessDeploy = require('../deploy/kubelessDeploy');
const serverless = require('./lib/serverless')();

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
    .callsFake(() => ({ then: (f) => f(fs.readFileSync(handlerFile).toString()) }));
  // Mock call to getFunctionContent when retrieving the requirements text
  kubelessDeploy.getFunctionContent
    .withArgs(path.basename(depsFile))
    .callsFake(() => ({ catch: () => ({ then: (f) => {
      if (fs.existsSync(depsFile)) {
        return f(fs.readFileSync(depsFile).toString());
      }
      return f(null);
    } }) })
  );
  sinon.stub(kubelessDeploy, 'waitForDeployment');
  return kubelessDeploy;
}

function mockThirdPartyResources(kubelessDeploy, namespace) {
  const thirdPartyResources = {
    namespaces: {
      namespace: namespace || 'default',
    },
    ns: {
      functions: {
        post: sinon.stub().callsFake((body, callback) => {
          callback(null, { statusCode: 200 });
        }),
        get: sinon.stub().callsFake((callback) => {
          callback(null, { statusCode: 200, body: { items: [] } });
        }),
      },
    },
    addResource: sinon.stub(),
  };
  sinon.stub(kubelessDeploy, 'getThirdPartyResources').returns(thirdPartyResources);
  return thirdPartyResources;
}

function mockExtensions(kubelessDeploy, namespace) {
  const extensions = {
    namespaces: {
      namespace: namespace || 'default',
    },
    ns: {
      ingress: {
        post: sinon.stub().callsFake((body, callback) => {
          callback(null, { statusCode: 200 });
        }),
      },
    },
    addResource: sinon.stub(),
  };
  sinon.stub(kubelessDeploy, 'getExtensions').returns(extensions);
  return extensions;
}

function mockKubeConfig() {
  const cwd = path.join(os.tmpdir(), moment().valueOf().toString());
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(cwd, '.kube'));
  fs.writeFileSync(
    path.join(cwd, '.kube/config'),
    'apiVersion: v1\n' +
    'current-context: cluster-id\n' +
    'clusters:\n' +
    '- cluster:\n' +
    '    certificate-authority-data: LS0tLS1\n' +
    '    server: http://1.2.3.4:4433\n' +
    '  name: cluster-name\n' +
    'contexts:\n' +
    '- context:\n' +
    '    cluster: cluster-name\n' +
    '    namespace: custom\n' +
    '    user: cluster-user\n' +
    '  name: cluster-id\n' +
    'users:\n' +
    '- name: cluster-user\n' +
    '  user:\n' +
    '    username: admin\n' +
    '    password: password1234\n'
  );
  process.env.HOME = cwd;
  return cwd;
}

const previousEnv = _.cloneDeep(process.env);
function restoreKubeConfig(cwd) {
  rm(cwd);
  process.env = _.cloneDeep(previousEnv);
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
  describe('#getThirdPartyResources', () => {
    let cwd = null;
    beforeEach(() => {
      cwd = mockKubeConfig();
    });
    afterEach(() => {
      restoreKubeConfig(cwd);
    });
    it('should instantiate taking the values from the kubernetes config', () => {
      const thirdPartyResources = KubelessDeploy.prototype.getThirdPartyResources(
        helpers.getConnectionOptions(helpers.loadKubeConfig())
      );
      expect(thirdPartyResources.url).to.be.eql('http://1.2.3.4:4433');
      expect(thirdPartyResources.requestOptions).to.be.eql({
        ca: Buffer.from('LS0tLS1', 'base64'),
        cert: undefined,
        key: undefined,
        auth: {
          user: 'admin',
          password: 'password1234',
        },
      });
      expect(thirdPartyResources.namespaces.namespace).to.be.eql('custom');
    });
  });

  describe('#waitForDeployment', () => {
    let clock = null;
    const kubelessDeploy = instantiateKubelessDeploy('', '', serverless);
    kubelessDeploy.waitForDeployment.restore();
    let cwd = null;
    beforeEach(() => {
      cwd = mockKubeConfig();
      sinon.stub(Api.Core.prototype, 'get');
      clock = sinon.useFakeTimers();
    });
    afterEach(() => {
      restoreKubeConfig(cwd);
      Api.Core.prototype.get.restore();
      clock.restore();
    });
    it('should wait until a deployment is ready', () => {
      const f = 'test';
      Api.Core.prototype.get.onFirstCall().callsFake((opts, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [{
              metadata: {
                labels: { function: f },
                creationTimestamp: moment().add('1', 's'),
              },
              status: {
                containerStatuses: [{
                  ready: false,
                  restartCount: 0,
                  state: 'Pending',
                }],
              },
            }],
          },
        });
      });
      Api.Core.prototype.get.callsFake((opts, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [{
              metadata: {
                labels: { function: f },
                creationTimestamp: moment(),
              },
              status: {
                containerStatuses: [{
                  ready: true,
                  restartCount: 0,
                  state: 'Ready',
                }],
              },
            }],
          },
        });
      });
      kubelessDeploy.waitForDeployment(f, moment());
      clock.tick(2001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(1);
      clock.tick(4001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(3);
      // The timer should be already cleared
      clock.tick(10001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(3);
    });
    it('should wait until a deployment is ready (with no containerStatuses info)', () => {
      const f = 'test';
      Api.Core.prototype.get.onFirstCall().callsFake((opts, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [{
              metadata: {
                labels: { function: f },
                creationTimestamp: moment().add('1', 's'),
              },
              status: {},
            }],
          },
        });
      });
      Api.Core.prototype.get.callsFake((opts, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [{
              metadata: {
                labels: { function: f },
                creationTimestamp: moment(),
              },
              status: {
                containerStatuses: [{
                  ready: true,
                  restartCount: 0,
                  state: 'Ready',
                }],
              },
            }],
          },
        });
      });
      kubelessDeploy.waitForDeployment(f, moment());
      clock.tick(2001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(1);
      clock.tick(4001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(3);
      // The timer should be already cleared
      clock.tick(10001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(3);
    });
    it('should throw an error if the pod failed to start', () => {
      const f = 'test';
      Api.Core.prototype.get.callsFake((opts, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [{
              metadata: {
                labels: { function: f },
                creationTimestamp: moment().add('1', 's'),
              },
              status: {
                containerStatuses: [{
                  ready: false,
                  restartCount: 3,
                  state: 'waiting',
                }],
              },
            }],
          },
        });
      });
      sinon.stub(kubelessDeploy.serverless.cli, 'log');
      try {
        kubelessDeploy.waitForDeployment(f, moment());
        clock.tick(4001);
        expect(kubelessDeploy.serverless.cli.log.lastCall.args[0]).to.be.eql(
          'ERROR: Failed to deploy the function'
        );
        expect(process.exitCode).to.be.eql(1);
      } finally {
        kubelessDeploy.serverless.cli.log.restore();
      }
    });
    it('should retry if it fails to retrieve pods info', () => {
      const f = 'test';
      Api.Core.prototype.get.onFirstCall().callsFake((opts, ff) => {
        ff(new Error('etcdserver: request timed out'));
      });
      Api.Core.prototype.get.callsFake((opts, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [{
              metadata: {
                labels: { function: f },
                creationTimestamp: moment(),
              },
              status: {
                containerStatuses: [{
                  ready: true,
                  restartCount: 0,
                  state: 'Ready',
                }],
              },
            }],
          },
        });
      });
      kubelessDeploy.waitForDeployment(f, moment());
      clock.tick(2001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(1);
      clock.tick(4001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(3);
      // The timer should be already cleared
      clock.tick(2001);
      expect(Api.Core.prototype.get.callCount).to.be.eql(3);
    });
    it('fail if the pod never appears', () => {
      const f = 'test';
      Api.Core.prototype.get.callsFake((opts, ff) => {
        ff(null, { statusCode: 200, body: {} });
      });
      const logStub = sinon.stub(kubelessDeploy.serverless.cli, 'log');
      try {
        kubelessDeploy.waitForDeployment(f, moment());
        clock.tick(10001);
        expect(logStub.lastCall.args[0]).to.contain(
          'unable to retrieve the status of the test deployment'
        );
      } finally {
        logStub.restore();
        // Api.Core.prototype.get.restore();
      }
    });
  });

  describe('#deploy', () => {
    let cwd = null;
    let handlerFile = null;
    let depsFile = null;
    const functionName = 'myFunction';
    const serverlessWithFunction = _.defaultsDeep({}, serverless, {
      config: {},
      service: {
        functions: {},
      },
    });
    serverlessWithFunction.service.functions[functionName] = {
      handler: 'function.hello',
    };

    let kubelessDeploy = null;
    let thirdPartyResources = null;

    beforeEach(() => {
      cwd = mockKubeConfig();
      serverlessWithFunction.config.servicePath = cwd;
      handlerFile = path.join(cwd, 'function.py');
      fs.writeFileSync(handlerFile, 'function code');
      depsFile = path.join(cwd, 'requirements.txt');
      kubelessDeploy = instantiateKubelessDeploy(handlerFile, depsFile, serverlessWithFunction);
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
    });
    after(() => {
      rm(cwd);
    });
    it('should deploy a function (python)', () => {
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(thirdPartyResources.ns.functions.post.firstCall.args[0].body).to.be.eql(
        { apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: functionName, namespace: 'default' },
          spec:
          { deps: '',
            function: 'function code',
            handler: 'function.hello',
            runtime: 'python2.7',
            type: 'HTTP' } }
      );
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should deploy a function (nodejs)', () => {
      handlerFile = path.join(cwd, 'function.js');
      depsFile = path.join(cwd, 'package.json');
      fs.writeFileSync(handlerFile, 'nodejs function code');
      fs.writeFileSync(depsFile, 'nodejs function deps');
      kubelessDeploy = instantiateKubelessDeploy(handlerFile, depsFile, _.defaultsDeep(
        { service: { provider: { runtime: 'nodejs6.10' } } },
        serverlessWithFunction
      ));
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(thirdPartyResources.ns.functions.post.firstCall.args[0].body).to.be.eql(
        { apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: functionName, namespace: 'default' },
          spec:
          { deps: 'nodejs function deps',
            function: 'nodejs function code',
            handler: 'function.hello',
            runtime: 'nodejs6.10',
            type: 'HTTP' } }
      );
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should deploy a function (ruby)', () => {
      handlerFile = path.join(cwd, 'function.rb');
      depsFile = path.join(cwd, 'Gemfile');
      fs.writeFileSync(handlerFile, 'ruby function code');
      fs.writeFileSync(depsFile, 'ruby function deps');
      kubelessDeploy = instantiateKubelessDeploy(handlerFile, depsFile, _.defaultsDeep(
        { service: { provider: { runtime: 'ruby2.4' } } },
        serverlessWithFunction
      ));
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(thirdPartyResources.ns.functions.post.firstCall.args[0].body).to.be.eql(
        { apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: functionName, namespace: 'default' },
          spec:
          { deps: 'ruby function deps',
            function: 'ruby function code',
            handler: 'function.hello',
            runtime: 'ruby2.4',
            type: 'HTTP' } }
      );
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should deploy a function in a custom namespace (in the provider section)', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.provider.namespace = 'custom';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy, 'custom');
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.metadata.namespace
      ).to.be.eql('custom');
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should deploy a function in a custom namespace (in the function section)', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.functions.myFunction.namespace = 'custom';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy, 'custom');
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.metadata.namespace
      ).to.be.eql('custom');
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should skip a deployment if the same specification is already deployed', () => {
      thirdPartyResources.ns.functions.get.callsFake((ff) => {
        ff(null, {
          items: [{
            metadata: {
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
              function: 'function code',
              handler: 'function.hello',
              runtime: 'python2.7',
              type: 'HTTP',
            },
          }],
        });
      });
      sinon.stub(serverlessWithFunction.cli, 'log');
      let result = null;
      try {
        result = expect( // eslint-disable-line no-unused-expressions
          kubelessDeploy.deployFunction()
        ).to.be.fulfilled;
        expect(serverlessWithFunction.cli.log.lastCall.args).to.be.eql(
          [
            `Function ${functionName} has not changed. Skipping deployment`,
          ]
        );
        expect(thirdPartyResources.ns.functions.post.callCount).to.be.eql(0);
      } finally {
        serverlessWithFunction.cli.log.restore();
      }
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
          [
            'The function myFunction already exists. ' +
            'Remove or redeploy it executing "sls deploy function -f myFunction".',
          ]
        );
      } finally {
        serverlessWithFunction.cli.log.restore();
      }
      return result;
    });
    it('should deploy a function triggered by a topic', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.functions[functionName].events = [{ trigger: 'topic' }];
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.spec.type
      ).to.be.eql('PubSub');
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.spec.topic
      ).to.be.eql('topic');
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[1]
      ).to.be.a('function');
      return result;
    });
    it('should deploy a function with a description', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      const desc = 'Test Description';
      serverlessWithCustomNamespace.service.functions[functionName].description = desc;
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post
          .firstCall.args[0].body.metadata.annotations['kubeless.serverless.com/description']
      ).to.be.eql(desc);
      return result;
    });
    it('should deploy a function with labels', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      const labels = { label1: 'Test Label' };
      serverlessWithCustomNamespace.service.functions[functionName].labels = labels;
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.metadata.labels
      ).to.be.eql(labels);
      return result;
    });
    it('should deploy a function with environment variables', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      const env = { VAR: 'test', OTHER_VAR: 'test2' };
      serverlessWithEnvVars.service.functions[functionName].environment = env;
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithEnvVars
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.spec.template.spec.containers
      ).to.be.eql([
        {
          name: functionName,
          env: [{ name: 'VAR', value: 'test' }, { name: 'OTHER_VAR', value: 'test2' }],
        },
      ]);
      return result;
    });
    it('should deploy a function with a memory limit', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.functions[functionName].memorySize = 128;
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithEnvVars
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.spec.template.spec.containers
      ).to.be.eql([
        {
          name: functionName,
          resources: {
            limits: { memory: '128Mi' },
            requests: { memory: '128Mi' },
          },
        },
      ]);
      return result;
    });
    it('should deploy a function with a memory limit (in the provider definition)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.provider.memorySize = '128Gi';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithEnvVars
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(
        thirdPartyResources.ns.functions.post.firstCall.args[0].body.spec.template.spec.containers
      ).to.be.eql([
        {
          name: functionName,
          resources: {
            limits: { memory: '128Gi' },
            requests: { memory: '128Gi' },
          },
        },
      ]);
      return result;
    });
    it('should deploy a function in a specific path', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { path: '/test' },
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomPath
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const extensions = mockExtensions(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(extensions.ns.ingress.post.firstCall.args[0].body).to.be.eql({
            kind: 'Ingress',
            metadata: {
              name: `ingress-${functionName}`,
              labels: { function: functionName },
              annotations:
              {
                'kubernetes.io/ingress.class': 'nginx',
                'ingress.kubernetes.io/rewrite-target': '/',
              },
            },
            spec: {
              rules: [{
                host: '1.2.3.4.nip.io',
                http: {
                  paths: [{
                    path: '/test',
                    backend: { serviceName: functionName, servicePort: 8080 },
                  }],
                },
              }],
            },
          });
        })).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with a specific hostname', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { },
      }];
      serverlessWithCustomPath.service.provider.hostname = 'test.com';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomPath
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const extensions = mockExtensions(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(extensions.ns.ingress.post.firstCall.args[0].body).to.be.eql({
            kind: 'Ingress',
            metadata: {
              name: `ingress-${functionName}`,
              labels: { function: functionName },
              annotations:
              {
                'kubernetes.io/ingress.class': 'nginx',
                'ingress.kubernetes.io/rewrite-target': '/',
              },
            },
            spec: {
              rules: [{
                host: 'test.com',
                http: {
                  paths: [{
                    path: '/',
                    backend: { serviceName: functionName, servicePort: 8080 },
                  }],
                },
              }],
            },
          });
        })).to.be.fulfilled;
      return result;
    });

    it('should deploy a function with a specific hostname and path', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { hostname: 'test.com', path: '/test' },
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomPath
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const extensions = mockExtensions(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(extensions.ns.ingress.post.firstCall.args[0].body).to.be.eql({
            kind: 'Ingress',
            metadata: {
              name: `ingress-${functionName}`,
              labels: { function: functionName },
              annotations:
              {
                'kubernetes.io/ingress.class': 'nginx',
                'ingress.kubernetes.io/rewrite-target': '/',
              },
            },
            spec: {
              rules: [{
                host: 'test.com',
                http: {
                  paths: [{
                    path: '/test',
                    backend: { serviceName: functionName, servicePort: 8080 },
                  }],
                },
              }],
            },
          });
        })).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with a specific hostname (in the function section)', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { hostname: 'test.com', path: '/test' },
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomPath
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const extensions = mockExtensions(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(extensions.ns.ingress.post.firstCall.args[0].body).to.be.eql({
            kind: 'Ingress',
            metadata: {
              name: `ingress-${functionName}`,
              labels: { function: functionName },
              annotations:
              {
                'kubernetes.io/ingress.class': 'nginx',
                'ingress.kubernetes.io/rewrite-target': '/',
              },
            },
            spec: {
              rules: [{
                host: 'test.com',
                http: {
                  paths: [{
                    path: '/test',
                    backend: { serviceName: functionName, servicePort: 8080 },
                  }],
                },
              }],
            },
          });
        })).to.be.fulfilled;
      return result;
    });
    it('should deploy a function in a specific path (with a custom namespace)', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { path: '/test' },
      }];
      serverlessWithCustomPath.service.functions[functionName].namespace = 'custom';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomPath
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      mockExtensions(kubelessDeploy, 'custom');
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(kubelessDeploy.getExtensions.firstCall.args[0].namespace).to.be.eql('custom');
        })
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function in a specific path (with a relative path)', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { path: 'test' },
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomPath
      );
      thirdPartyResources = mockThirdPartyResources(kubelessDeploy);
      const extensions = mockExtensions(kubelessDeploy);
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(
            extensions.ns.ingress.post.firstCall.args[0].body.spec.rules[0].http.paths[0].path
          ).to.be.eql('/test');
        })).to.be.fulfilled;
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
        'Error: Unable to deploy the function myFunction. Received:\n' +
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
        'Error: Unable to deploy the function myFunction2. Received:\n' +
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
      mockKubeConfig(cwd);
      const result = expect(kubelessDeploy.deployFunction()).to.be.fulfilled;
      expect(thirdPartyResources.ns.functions.post.calledOnce).to.be.eql(true);
      expect(thirdPartyResources.ns.functions.post.firstCall.args[0].body).to.be.eql(
        { apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: functionName, namespace: 'default' },
          spec:
          { deps: '',
            function: 'different function content',
            handler: 'function.hello',
            runtime: 'python2.7',
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
      mockKubeConfig(cwd);
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
