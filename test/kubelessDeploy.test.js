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
const nock = require('nock');
const mocks = require('./lib/mocks');
const moment = require('moment');
const os = require('os');
const path = require('path');
const rm = require('./lib/rm');
const sinon = require('sinon');

const KubelessDeploy = require('../deploy/kubelessDeploy');
const serverless = require('./lib/serverless')();

require('chai').use(chaiAsPromised);

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
      expect(() => kubelessDeploy.validate()).to.not.throw();
      expect(serverless.cli.log.firstCall.args).to.be.eql(
          ['Warning: Option region is not supported for the kubeless plugin']
        );
    });
  });

  describe('#deploy', () => {
    let clock = null;
    let cwd = null;
    let config = null;
    let handlerFile = null;
    let depsFile = null;
    const functionName = 'myFunction';
    const functionText = 'function code';
    let serverlessWithFunction = null;

    let kubelessDeploy = null;

    beforeEach(() => {
      cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
      setInterval(() => {
        clock.tick(2001);
      }, 100);
      clock = sinon.useFakeTimers();
      config = mocks.kubeConfig(cwd);
      serverlessWithFunction = _.defaultsDeep({}, serverless, {
        config: {},
        service: {
          functions: {},
        },
      });
      serverlessWithFunction.service.functions[functionName] = {
        handler: 'function.hello',
      };
      serverlessWithFunction.config.servicePath = cwd;
      handlerFile = path.join(cwd, 'function.py');
      fs.writeFileSync(handlerFile, functionText);
      depsFile = path.join(cwd, 'requirements.txt');
      kubelessDeploy = instantiateKubelessDeploy(handlerFile, depsFile, serverlessWithFunction);
    });
    afterEach(() => {
      clock.restore();
      nock.cleanAll();
      rm(cwd);
    });
    it('should deploy a function (python)', () => {
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function (nodejs)', () => {
      handlerFile = path.join(cwd, 'function.js');
      depsFile = path.join(cwd, 'package.json');
      fs.writeFileSync(handlerFile, 'nodejs function code');
      fs.writeFileSync(depsFile, 'nodejs function deps');
      kubelessDeploy = instantiateKubelessDeploy(handlerFile, depsFile, _.defaultsDeep(
        { service: { provider: { runtime: 'nodejs6' } } },
        serverlessWithFunction
      ));
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: 'nodejs function deps',
        function: 'nodejs function code',
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: 'nodejs6',
        type: 'HTTP',
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: 'ruby function deps',
        function: 'ruby function code',
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: 'ruby2.4',
        type: 'HTTP',
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function in a custom namespace (in the provider section)', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.provider.namespace = 'custom';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      }, { namespace: 'custom' });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function in a custom namespace (in the function section)', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.functions.myFunction.namespace = 'custom';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      }, { namespace: 'custom' });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });

    it('should wait until a deployment is ready', () => {
      const funcSpec = {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      };
      // First call, still deploying:
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/pods')
        .reply(200, {
          items: [{
            metadata: {
              name: functionName,
              labels: { function: functionName },
              creationTimestamp: moment().add('60', 's'),
            },
            spec: funcSpec,
            status: {
              containerStatuses: [{ ready: false, restartCount: 0 }],
            },
          }],
        });
      // Second call, ready:
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec);
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(nock.pendingMocks()).to.be.eql([]);
        })
      ).to.be.fulfilled;
    });
    it('should wait until a deployment is ready (with no containerStatuses info)', () => {
      const funcSpec = {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      };
      // First call, still deploying:
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/pods')
        .reply(200, {
          items: [{
            metadata: {
              name: functionName,
              labels: { function: functionName },
              creationTimestamp: moment().add('60', 's'),
            },
            spec: funcSpec,
            status: {},
          }],
        });
      // Second call, ready:
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec);
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(nock.pendingMocks()).to.be.eql([]);
        })
      ).to.be.fulfilled;
    });
    it('should throw an error if the pod failed to start', () => {
      const funcSpec = {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      };
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/pods')
        .reply(200, {
          items: [{
            metadata: {
              name: functionName,
              labels: { function: functionName },
              creationTimestamp: moment().add('60', 's'),
            },
            spec: funcSpec,
            status: {
              containerStatuses: [{ ready: false, restartCount: 3 }],
            },
          }],
        });
      kubelessDeploy.deployFunction().then(() => {
        expect(kubelessDeploy.serverless.cli.log.lastCall.args[0]).to.be.eql(
            'ERROR: Failed to deploy the function'
          );
        expect(process.exitCode).to.be.eql(1);
        kubelessDeploy.serverless.cli.log.restore();
      });
    });
    it('should retry if it fails to retrieve pods info', () => {
      const funcSpec = {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      };
      // First call, fails to retrieve status
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/pods')
        .replyWithError('etcdserver: request timed out');
      // Second call, ready:
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec);
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(nock.pendingMocks()).to.be.eql([]);
        })
      ).to.be.fulfilled;
    });
    it('fail if the pod never appears', () => {
      const funcSpec = {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      };
      // First call, fails to retrieve status
      nock(config.clusters[0].cluster.server)
        .persist()
        .get('/api/v1/pods')
        .reply(200, { items: [] });
      // Second call, ready:
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec);
      // return expect( // eslint-disable-line no-unused-expressions
      expect(
        kubelessDeploy.deployFunction()
      ).to.be.eventually.rejectedWith(
        `Unable to retrieve the status of the ${functionName} deployment`
      );
    });

    it('should skip a deployment if the same specification is already deployed', () => {
      const funcSpec = {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      };
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec, {
        existingFunctions: [{
          metadata: {
            name: functionName,
            labels: { function: functionName },
          },
          spec: funcSpec,
        }],
      });
      let result = null;
      result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(serverlessWithFunction.cli.log.lastCall.args).to.be.eql(
            [
              `Function ${functionName} has not changed. Skipping deployment`,
            ]
            );
          expect(nock.pendingMocks()).to.contain(
            `POST ${config.clusters[0].cluster.server}/apis/k8s.io/v1/namespaces/default/functions/`
          );
        })
      ).to.be.fulfilled;
      return result;
    });
    it('should skip a deployment if an error 409 is returned', () => {
      nock(config.clusters[0].cluster.server)
        .get('/apis/k8s.io/v1/namespaces/default/functions/')
        .reply(200, []);
      nock(config.clusters[0].cluster.server)
        .post('/apis/k8s.io/v1/namespaces/default/functions/')
        .reply(409, '{"code": 409, "message": "Resource already exists"}');
      let result = null;
      kubelessDeploy.options.force = false;
      result = expect( // eslint-disable-line no-unused-expressions
          kubelessDeploy.deployFunction().then(() => {
            expect(serverlessWithFunction.cli.log.lastCall.args).to.be.eql(
              [
                'The function myFunction already exists. ' +
                'Redeploy it usign --force or executing "sls deploy function -f myFunction".',
              ]
            );
          })
        ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function triggered by a topic', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.functions[functionName].events = [{
        trigger: 'topic',
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'PubSub',
        topic: 'topic',
      });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function triggered by a schedule', () => {
      const serverlessWithScheduler = _.cloneDeep(serverlessWithFunction);
      serverlessWithScheduler.service.functions[functionName].events = [{
        schedule: '* * * * *',
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithScheduler
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'Scheduled',
        schedule: '* * * * *',
      });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      }, { description: desc });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      }, { labels });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
        template: {
          spec: {
            containers: [{
              name: functionName,
              env: [{ name: 'VAR', value: 'test' }, { name: 'OTHER_VAR', value: 'test2' }],
            }],
          },
        },
      });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
        template: {
          spec: {
            containers: [{
              name: functionName,
              resources: {
                limits: { memory: '128Mi' },
                requests: { memory: '128Mi' },
              },
            }],
          },
        },
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with a memory limit (in the provider definition)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.provider.memorySize = '128Gi';
      kubelessDeploy = instantiateKubelessDeploy(
        handlerFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
        template: {
          spec: {
            containers: [{
              name: functionName,
              resources: {
                limits: { memory: '128Gi' },
                requests: { memory: '128Gi' },
              },
            }],
          },
        },
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      mocks.createIngressNocks(
        config.clusters[0].cluster.server,
        functionName,
        '1.2.3.4.nip.io',
        '/test'
      );
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      mocks.createIngressNocks(
        config.clusters[0].cluster.server,
        functionName,
        'test.com',
        '/'
      );
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      mocks.createIngressNocks(
        config.clusters[0].cluster.server,
        functionName,
        'test.com',
        '/test'
      );
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      mocks.createIngressNocks(
        config.clusters[0].cluster.server,
        functionName,
        'test.com',
        '/test'
      );
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      }, { namespace: 'custom' });
      mocks.createIngressNocks(
        config.clusters[0].cluster.server,
        functionName,
        '1.2.3.4.nip.io',
        '/test',
        { namespace: 'custom' }
      );
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      mocks.createIngressNocks(
        config.clusters[0].cluster.server,
        functionName,
        '1.2.3.4.nip.io',
        '/test'
      );
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should fail if a deployment returns an error code', () => {
      nock(config.clusters[0].cluster.server)
        .get('/apis/k8s.io/v1/namespaces/default/functions/')
        .reply(200, []);
      nock(config.clusters[0].cluster.server)
        .post('/apis/k8s.io/v1/namespaces/default/functions/')
        .reply(500, JSON.stringify({ code: 500, message: 'Internal server error' }));
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
      const funcSpec = {
        deps: '',
        function: functionText,
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      };
      const postReply = (uri, req) => {
        functionsDeployed.push(req.metadata.name);
      };
      // Call for myFunction1
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, 'myFunction1', funcSpec, {
        postReply,
      });
      // Call for myFunction2
      nock(config.clusters[0].cluster.server)
        .post('/apis/k8s.io/v1/namespaces/default/functions', {
          apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: 'myFunction2', namespace: 'default' },
          spec: funcSpec,
        })
        .reply(500, 'Internal server error');
      // Call for myFunction3
      nock(config.clusters[0].cluster.server)
        .post('/apis/k8s.io/v1/namespaces/default/functions', {
          apiVersion: 'k8s.io/v1',
          kind: 'Function',
          metadata: { name: 'myFunction3', namespace: 'default' },
          spec: funcSpec,
        })
        .reply(200, postReply);

      kubelessDeploy.deployFunction().catch(e => {
        expect(e).to.be.eql(
          'Found errors while deploying the given functions:\n' +
          'Error: Unable to deploy the function myFunction2. Received:\n' +
          '  Code: 500\n' +
          '  Message: Internal server error'
        );
      }).then(() => {
        expect(functionsDeployed).to.be.eql(['myFunction1', 'myFunction3']);
      });
    });
    it('should deploy a function using the given package', () => {
      kubelessDeploy = new KubelessDeploy(serverlessWithFunction, {
        package: path.join(cwd, 'package.zip'),
      });
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: '',
        function: 'different function content',
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with requirements', () => {
      kubelessDeploy = new KubelessDeploy(serverlessWithFunction);
      fs.writeFileSync(depsFile, 'request');
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: 'request',
        function: 'function code',
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          fs.unlinkSync(path.join(cwd, 'requirements.txt'), 'request');
        })
      ).to.be.fulfilled;
    });
    it('should deploy a function with requirements using the given package', () => {
      kubelessDeploy = new KubelessDeploy(serverlessWithFunction, {
        package: path.join(cwd, 'package.zip'),
      });
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, {
        deps: 'request',
        function: 'different function content',
        handler: serverlessWithFunction.service.functions[functionName].handler,
        runtime: serverlessWithFunction.service.provider.runtime,
        type: 'HTTP',
      });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should redeploy a function', () => {
      fs.writeFileSync(handlerFile, 'function code modified');
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
            function: 'function code modified',
            handler: 'function.hello',
            runtime: 'python2.7',
            type: 'HTTP',
          },
        })
        .reply(200, '{"message": "OK"}');
      kubelessDeploy.options.force = true;
      let result = null;
      result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(nock.pendingMocks()).to.contain(
            `POST ${config.clusters[0].cluster.server}/apis/k8s.io/v1/namespaces/default/functions/`
          );
          expect(nock.pendingMocks()).to.not.contain(
            `PATCH ${config.clusters[0].cluster.server}/apis/k8s.io/v1/namespaces/default/functions/${functionName}` // eslint-disable-line max-len
          );
        })
      ).to.be.fulfilled;
      return result;
    });
    it('should fail if a redeployment returns an error code', () => {
      fs.writeFileSync(handlerFile, 'function code modified');
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
            function: 'function code modified',
            handler: 'function.hello',
            runtime: 'python2.7',
            type: 'HTTP',
          },
        })
        .reply(500, '{"code": 500, "message": "Internal server error"}');
      kubelessDeploy.options.force = true;
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.eventually.rejectedWith(
        'Found errors while deploying the given functions:\n' +
        'Error: Unable to update the function myFunction. Received:\n' +
        '  Code: 500\n' +
        '  Message: Internal server error'
        );
    });
  });
});
