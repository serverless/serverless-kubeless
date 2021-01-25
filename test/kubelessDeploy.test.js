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
const serverlessFact = require('./lib/serverless');

let serverless = serverlessFact();

require('chai').use(chaiAsPromised);

function instantiateKubelessDeploy(zipFile, depsFile, serverlessWithFunction, options) {
  const kubelessDeploy = new KubelessDeploy(serverlessWithFunction, options);
  // Mock call to getFunctionContent when retrieving the function code
  sinon.stub(kubelessDeploy, 'getFileContent');
  // Mock call to getFunctionContent when retrieving the requirements text
  kubelessDeploy.getFileContent
    .withArgs(zipFile, path.basename(depsFile))
    .callsFake(() => ({ catch: () => ({ then: (f) => {
      if (fs.existsSync(depsFile)) {
        return f(fs.readFileSync(depsFile).toString());
      }
      return f(null);
    } }) })
  );
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
    let pkgFile = null;
    let depsFile = null;
    const functionName = 'myFunction';
    const functionRawText = 'function code';
    const functionChecksum =
      'sha256:ce182d715b42b27f1babf8b4196cd4f8c900ca6593a4293d455d1e5e2296ebee';
    const functionText = new Buffer(functionRawText).toString('base64');
    let serverlessWithFunction = null;

    let kubelessDeploy = null;
    let defaultFuncSpec = null;
    beforeEach(() => {
      serverless = serverlessFact();
      cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
      fs.mkdirSync(path.join(cwd, '.serverless'));
      setInterval(() => {
        clock.tick(2001);
      }, 100);
      clock = sinon.useFakeTimers();
      config = mocks.kubeConfig(cwd);
      pkgFile = path.join(cwd, `.serverless/${functionName}.zip`);
      fs.writeFileSync(pkgFile, functionRawText);
      serverlessWithFunction = _.defaultsDeep({}, serverless, {
        config: {
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
      serverlessWithFunction.config.servicePath = cwd;
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
      depsFile = path.join(cwd, 'requirements.txt');
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, serverlessWithFunction);
    });

    afterEach(() => {
      clock.restore();
      nock.cleanAll();
      rm(cwd);
    });
    it('should deploy a function (python)', () => {
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function (nodejs)', () => {
      depsFile = path.join(cwd, 'package.json');
      fs.writeFileSync(depsFile, 'nodejs function deps');
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, _.defaultsDeep(
        { service: { provider: { runtime: 'nodejs6' } } },
        serverlessWithFunction
      ));
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'nodejs function deps',
        runtime: 'nodejs6',
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function (nodejs) individually pre-packaged', () => {
      depsFile = path.join(cwd, 'package.json');
      fs.writeFileSync(depsFile, 'nodejs function deps');
      serverlessWithFunction.service.package.individually = true;
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, _.defaultsDeep(
          { service: { provider: { runtime: 'nodejs6' } } },
          serverlessWithFunction
      ));
      kubelessDeploy.options.package = path.join(cwd, '.serverless/');
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'nodejs function deps',
        runtime: 'nodejs6',
      }));
      return expect( // eslint-disable-line no-unused-expressions
          kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function (nodejs) with function level runtime override', () => {
      depsFile = path.join(cwd, 'package.json');
      fs.writeFileSync(depsFile, 'nodejs function deps');
      serverlessWithFunction.service.functions[functionName].runtime = 'nodejs6';
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, _.defaultsDeep(
        { service: { provider: { runtime: 'ruby2.4' } } },
        serverlessWithFunction
      ));
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'nodejs function deps',
        runtime: 'nodejs6',
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function (ruby)', () => {
      depsFile = path.join(cwd, 'Gemfile');
      fs.writeFileSync(depsFile, 'ruby function deps');
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, _.defaultsDeep(
        { service: { provider: { runtime: 'ruby2.4' } } },
        serverlessWithFunction
      ));
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'ruby function deps',
        runtime: 'ruby2.4',
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function (ruby) with function level runtime override', () => {
      depsFile = path.join(cwd, 'Gemfile');
      fs.writeFileSync(depsFile, 'ruby function deps');
      serverlessWithFunction.service.functions[functionName].runtime = 'ruby2.4';
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, _.defaultsDeep(
        { service: { provider: { runtime: 'golang1.11' } } },
        serverlessWithFunction
      ));
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'ruby function deps',
        runtime: 'ruby2.4',
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with custom runtime image (in the provider section)', () => {
      const serverlessWithImage = _.cloneDeep(serverlessWithFunction);
      serverlessWithImage.service.provider.image = 'some-custom-image';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithImage
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  image: 'some-custom-image',
                }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with custom runtime image (in the function section)', () => {
      const serverlessWithImage = _.cloneDeep(serverlessWithFunction);
      serverlessWithImage.service.functions[functionName].image = 'some-custom-image';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithImage
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  image: 'some-custom-image',
                }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function overriding runtime image', () => {
      const serverlessWithImage = _.cloneDeep(serverlessWithFunction);
      serverlessWithImage.service.provider.image = 'global-custom-image';
      serverlessWithImage.service.functions[functionName].image = 'local-custom-image';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithImage
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  image: 'local-custom-image',
                }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function in a custom namespace (in the provider section)', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.provider.namespace = 'custom';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server,
        functionName, defaultFuncSpec(), { namespace: 'custom' });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function in a custom namespace (in the function section)', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.functions.myFunction.namespace = 'custom';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server,
        functionName, defaultFuncSpec(), { namespace: 'custom' });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with Secrets', () => {
      const serverlessWithSecrets = _.cloneDeep(serverlessWithFunction);
      serverlessWithSecrets.service.functions.myFunction.secrets = ['secret1'];
      kubelessDeploy = instantiateKubelessDeploy(
          pkgFile,
          depsFile,
          serverlessWithSecrets
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  volumeMounts: [{ name: 'secret1-vol', mountPath: '/secret1' }],
                }],
                volumes: [{ name: 'secret1-vol', secret: { secretName: 'secret1' } }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
          kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with volumes', () => {
      const serverlessWithVolumes = _.cloneDeep(serverlessWithFunction);
      serverlessWithVolumes.service.functions.myFunction.volumes = [{
        name: 'vol1',
        persistentVolumeClaim: {
          claimName: 'vol-claim',
        },
      }];
      serverlessWithVolumes.service.functions.myFunction.volumeMounts = [{
        name: 'vol1',
        mountPath: '/foo/bar',
      }];
      kubelessDeploy = instantiateKubelessDeploy(
          pkgFile,
          depsFile,
          serverlessWithVolumes
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  volumeMounts: [{ name: 'vol1', mountPath: '/foo/bar' }],
                }],
                volumes: [{ name: 'vol1', persistentVolumeClaim: { claimName: 'vol-claim' } }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
          kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });


    it('should wait until a deployment is ready', () => {
      const funcSpec = defaultFuncSpec();
      // First call, still deploying:
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/namespaces/default/pods')
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
      const funcSpec = defaultFuncSpec();
      // First call, still deploying:
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/namespaces/default/pods')
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
      const funcSpec = defaultFuncSpec();
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/namespaces/default/pods')
        .times(10)
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
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec);
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().catch(() => {
          expect(kubelessDeploy.serverless.cli.log.lastCall.args[0]).to.be.eql(
            'ERROR: Failed to deploy the function'
          );
          expect(process.exitCode).to.be.eql(1);
        })
      ).to.be.fulfilled;
    });
    it('should retry if it fails to retrieve pods info', () => {
      const funcSpec = defaultFuncSpec();
      // First call, fails to retrieve status
      nock(config.clusters[0].cluster.server)
        .get('/api/v1/namespaces/default/pods')
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
      const funcSpec = defaultFuncSpec();
      // First call, fails to retrieve status
      nock(config.clusters[0].cluster.server)
        .persist()
        .get('/api/v1/namespaces/default/pods')
        .reply(200, { items: [] });
      // Second call, ready:
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec);
      // return expect( // eslint-disable-line no-unused-expressions
      return expect(
        kubelessDeploy.deployFunction()
      ).to.be.eventually.rejectedWith(
        `Unable to retrieve the status of the ${functionName} deployment`
      );
    });

    it('should skip a deployment if the same specification is already deployed', () => {
      const funcSpec = defaultFuncSpec();
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec, {
        functionExists: true,
      });
      let result = null;
      result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(serverlessWithFunction.cli.log.lastCall.args).to.be.eql(
            [
              `Function ${functionName} already exists. Skipping deployment`,
            ]
            );
          expect(nock.pendingMocks()).to.contain(
            /* eslint-disable max-len*/
            `POST ${config.clusters[0].cluster.server}/apis/kubeless.io/v1beta1/namespaces/default/functions/`
            /* eslint-enable max-len */
          );
        })
      ).to.be.fulfilled;
      return result;
    });
    it('should skip a deployment if an error 409 is returned', () => {
      nock(config.clusters[0].cluster.server)
        .post('/apis/kubeless.io/v1beta1/namespaces/default/functions/')
        .reply(409, '{"code": 409, "message": "Resource already exists"}');
      const funcSpec = defaultFuncSpec();
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec);
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
    it('should deploy a function triggered by a topic on kafka', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.functions[functionName].events = [{
        trigger: 'topic',
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      const triggerName = _.kebabCase(`${functionName}-topic`);
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/kafkatriggers/${triggerName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      nock(config.clusters[0].cluster.server)
        .post('/apis/kubeless.io/v1beta1/namespaces/default/kafkatriggers/', {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'KafkaTrigger',
          metadata: {
            name: triggerName,
            namespace: 'default',
            labels: {
              'created-by': 'kubeless',
            },
          },
          spec: {
            functionSelector: {
              matchLabels: {
                'created-by': 'kubeless',
                function: functionName,
              },
            },
            topic: 'topic',
          },
        })
        .reply(200, { message: 'OK' });

      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function triggered by a topic on nats', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomNamespace.service.functions[functionName].events = [{
        trigger: {
          queue: 'nats',
          topic: 'topic',
        },
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      const triggerName = _.kebabCase(`${functionName}-topic`);
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/natstriggers/${triggerName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      nock(config.clusters[0].cluster.server)
        .post('/apis/kubeless.io/v1beta1/namespaces/default/natstriggers/', {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'NATSTrigger',
          metadata: {
            name: triggerName,
            namespace: 'default',
            labels: {
              'created-by': 'kubeless',
            },
          },
          spec: {
            functionSelector: {
              matchLabels: {
                'created-by': 'kubeless',
                function: functionName,
              },
            },
            topic: 'topic',
          },
        })
        .reply(200, { message: 'OK' });

      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
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
        pkgFile,
        depsFile,
        serverlessWithScheduler
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/cronjobtriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      nock(config.clusters[0].cluster.server)
        .post('/apis/kubeless.io/v1beta1/namespaces/default/cronjobtriggers/', {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'CronJobTrigger',
          metadata: {
            name: functionName,
            namespace: 'default',
            labels: {
              'created-by': 'kubeless',
            },
          },
          spec: {
            'function-name': functionName,
            schedule: '* * * * *',
          },
        })
        .reply(200, { message: 'OK' });
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
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
        pkgFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec(), { description: desc });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with labels', () => {
      const serverlessWithCustomNamespace = _.cloneDeep(serverlessWithFunction);
      const labels = {
        label1: 'Test Label',
        label2: false,
        label3: null,
        label4: undefined,
        label5: 1,
        label6: { a: 1 },
      };
      const sLabels = {
        label1: 'Test Label',
        label2: 'false',
        label3: 'null',
        label4: 'undefined',
        label5: '1',
        label6: '{"a":1}',
      };
      serverlessWithCustomNamespace.service.functions[functionName].labels = labels;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomNamespace
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec(), { labels: sLabels });
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with environment variables defined as a dictionary', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      const env = { VAR: 'test', OTHER_VAR: 'test2' };
      serverlessWithEnvVars.service.functions[functionName].environment = env;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  env: [{ name: 'VAR', value: 'test' }, { name: 'OTHER_VAR', value: 'test2' }],
                }],
              },
            },
          },
        },
      }));
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with environment variables defined as an array)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      const env = [
        { name: 'VAR', value: 'test' },
        { name: 'OTHER_VAR', valueFrom: { someRef: { name: 'REF_OBJECT', key: 'REF_KEY' } } },
      ];
      serverlessWithEnvVars.service.functions[functionName].environment = env;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  env: [
                { name: 'VAR', value: 'test' },
                    {
                      name: 'OTHER_VAR',
                      valueFrom: { someRef: { name: 'REF_OBJECT', key: 'REF_KEY' } },
                    },
                  ],
                }],
              },
            },
          },
        },
      }));
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with environment variables in provider section', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.provider.environment = {
        FOO: 'bar',
      };
      const env = [
        { name: 'VAR', value: 'test' },
        { name: 'OTHER_VAR', valueFrom: { someRef: { name: 'REF_OBJECT', key: 'REF_KEY' } } },
      ];
      serverlessWithEnvVars.service.functions[functionName].environment = env;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  env: [
                    { name: 'FOO', value: 'bar' },
                    { name: 'VAR', value: 'test' },
                    {
                      name: 'OTHER_VAR',
                      valueFrom: { someRef: { name: 'REF_OBJECT', key: 'REF_KEY' } },
                    },
                  ],
                }],
              },
            },
          },
        },
      }));
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with a memory limit', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.functions[functionName].memorySize = 128;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
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
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with a memory limit (in the provider definition)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.provider.memorySize = '128Gi';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
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
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with a cpu limit', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.functions[functionName].cpu = '500m';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  resources: {
                    limits: { cpu: '500m' },
                    requests: { cpu: '500m' },
                  },
                }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with a cpu limit (in the provider definition)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.provider.cpu = '500m';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  resources: {
                    limits: { cpu: '500m' },
                    requests: { cpu: '500m' },
                  },
                }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with a memory and cpu limit', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.functions[functionName].memorySize = '128Gi';
      serverlessWithEnvVars.service.functions[functionName].cpu = '500m';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  resources: {
                    limits: { cpu: '500m', memory: '128Gi' },
                    requests: { cpu: '500m', memory: '128Gi' },
                  },
                }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with a memory and cpu limit (in the provider definition)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);
      serverlessWithEnvVars.service.provider.cpu = '500m';
      serverlessWithEnvVars.service.provider.memorySize = '128Gi';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                  resources: {
                    limits: { cpu: '500m', memory: '128Gi' },
                    requests: { cpu: '500m', memory: '128Gi' },
                  },
                }],
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with an affinity defined', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);

      const affinityDefintion = {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [{
              matchExpressions: [{
                key: 'kubernetes.io/e2e-az-name',
                operator: 'In',
                values: ['e2e-az1', 'e2e-az2'],
              }],
            }],
          },
        },
      };

      serverlessWithEnvVars.service.functions[functionName].affinity = affinityDefintion;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                }],
                affinity: affinityDefintion,
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });

    it('should deploy a function with an affinity defined (in the provider definition)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);

      const affinityDefintion = {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [{
              matchExpressions: [{
                key: 'kubernetes.io/e2e-az-name',
                operator: 'In',
                values: ['e2e-az1', 'e2e-az2'],
              }],
            }],
          },
        },
      };

      serverlessWithEnvVars.service.provider.affinity = affinityDefintion;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                }],
                affinity: affinityDefintion,
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with an tolerations defined', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);

      const tolerations = [{
        key: 'key1',
        operator: 'Equal',
        value: 'value1',
        effect: 'NoSchedule',
      }];

      serverlessWithEnvVars.service.functions[functionName].tolerations = tolerations;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                }],
                tolerations,
              },
            },
          },
        },
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });

    it('should deploy a function with tolerations defined (in the provider definition)', () => {
      const serverlessWithEnvVars = _.cloneDeep(serverlessWithFunction);

      const tolerations = [{
        key: 'key1',
        operator: 'Equal',
        value: 'value1',
        effect: 'NoSchedule',
      }];

      serverlessWithEnvVars.service.provider.tolerations = tolerations;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithEnvVars
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deployment: {
          spec: {
            template: {
              spec: {
                containers: [{
                  name: functionName,
                }],
                tolerations,
              },
            },
          },
        },
      }));
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
        pkgFile,
        depsFile,
        serverlessWithCustomPath
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/httptriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      mocks.createTriggerNocks(
        config.clusters[0].cluster.server,
        functionName,
        '1.2.3.4.nip.io',
        '/test'
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with a specific hostname', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { path: '/' },
      }];
      serverlessWithCustomPath.service.provider.hostname = 'test.com';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomPath
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/httptriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      mocks.createTriggerNocks(
        config.clusters[0].cluster.server,
        functionName,
        'test.com',
        '/'
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
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
        pkgFile,
        depsFile,
        serverlessWithCustomPath
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/httptriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      mocks.createTriggerNocks(
        config.clusters[0].cluster.server,
        functionName,
        'test.com',
        '/test'
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
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
        pkgFile,
        depsFile,
        serverlessWithCustomPath
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/httptriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      mocks.createTriggerNocks(
        config.clusters[0].cluster.server,
        functionName,
        'test.com',
        '/test'
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function in a specific path (with a custom namespace)', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { path: '/test' },
      }];
      serverlessWithCustomPath.service.functions[functionName].namespace = 'myns';
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomPath
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/myns/httptriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      mocks.createTriggerNocks(
        config.clusters[0].cluster.server,
        functionName,
        '1.2.3.4.nip.io',
        '/test',
        { namespace: 'myns' }
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server,
        functionName, defaultFuncSpec(), { namespace: 'myns' });
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
        pkgFile,
        depsFile,
        serverlessWithCustomPath
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/httptriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      mocks.createTriggerNocks(
        config.clusters[0].cluster.server,
        functionName,
        '1.2.3.4.nip.io',
        '/test'
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function in a specific path (with a different DNS resolution)', () => {
      const serverlessWithCustomPath = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomPath.service.provider.defaultDNSResolution = 'xip.io';
      serverlessWithCustomPath.service.functions[functionName].events = [{
        http: { path: '/test' },
      }];
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomPath
      );
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/httptriggers/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      mocks.createTriggerNocks(
        config.clusters[0].cluster.server,
        functionName,
        '1.2.3.4.xip.io',
        '/test'
      );
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec());
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should fail if a deployment returns an error code', () => {
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/default/functions/${functionName}`)
        .reply(404, JSON.stringify({ code: 404 }));
      nock(config.clusters[0].cluster.server)
        .persist()
        .get('/api/v1/namespaces/kubeless/configmaps/kubeless-config')
        .reply(200, JSON.stringify({
          data: {
            'runtime-images': JSON.stringify([
              { ID: 'python', depName: 'requirements.txt' },
              { ID: 'nodejs', depName: 'package.json' },
              { ID: 'ruby', depName: 'Gemfile' },
            ]),
          },
        }));
      nock(config.clusters[0].cluster.server)
        .post('/apis/kubeless.io/v1beta1/namespaces/default/functions/')
        .reply(500, JSON.stringify({ code: 500, message: 'Internal server error' }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.eventually.rejectedWith('Code: 500\n  Message: Internal server error');
    });
    it('should deploy the possible functions even if one of them fails', () => {
      const serverlessWithFunctions = _.defaultsDeep({}, serverless, {
        service: {
          functions: {
            myFunction: {
              handler: 'function.hello',
              package: {},
            },
            myFunction2: {
              handler: 'function.hello',
              package: {},
            },
            myFunction3: {
              handler: 'function.hello',
              package: {},
            },
          },
        },
      });
      const functionsDeployed = [];
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, serverlessWithFunctions);
      const funcSpec = defaultFuncSpec();
      const postReply = (uri, req) => {
        functionsDeployed.push(req.metadata.name);
        return JSON.stringify(req);
      };
      nock(config.clusters[0].cluster.server)
        .persist()
        .get('/api/v1/namespaces/default/pods')
        .reply(200, () => ({
          items: [
            {
              metadata: {
                name: 'myFunction3',
                labels: { function: 'myFunction3' },
                annotations: {},
                creationTimestamp: moment().add('60', 's'),
              },
              spec: funcSpec,
              status: {
                containerStatuses: [{ ready: true, restartCount: 0 }],
              },
            },
            {
              metadata: {
                name: functionName,
                labels: { function: functionName },
                annotations: {},
                creationTimestamp: moment().add('60', 's'),
              },
              spec: funcSpec,
              status: {
                containerStatuses: [{ ready: true, restartCount: 0 }],
              },
            }],
        }));
      nock(config.clusters[0].cluster.server)
        .persist()
        .get('/api/v1/namespaces/default/services')
        .reply(200, () => ({
          items: [
            {
              metadata: {
                name: 'myFunction3',
                labels: { function: 'myFunction3' },
                annotations: {},
                creationTimestamp: moment().add('60', 's'),
              },
            },
            {
              metadata: {
                name: functionName,
                labels: { function: functionName },
                annotations: {},
                creationTimestamp: moment().add('60', 's'),
              },
            }],
        }));

      // Call for myFunction1
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, funcSpec, {
        postReply,
      });
      // Call for myFunction2
      const func2Spec = defaultFuncSpec();
      func2Spec.service.selector = { function: 'myFunction2' };
      nock(config.clusters[0].cluster.server)
        .get('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction2')
        .reply(404, JSON.stringify({ code: 404 }));
      nock(config.clusters[0].cluster.server)
        .post('/apis/kubeless.io/v1beta1/namespaces/default/functions/', {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'Function',
          metadata: {
            name: 'myFunction2',
            namespace: 'default',
            labels: { 'created-by': 'kubeless', function: 'myFunction2' },
            annotations: {},
          },
          spec: func2Spec,
        })
        .replyWithError({ message: 'Internal server error', code: 500 });
      // Call for myFunction3
      const func3Spec = defaultFuncSpec();
      func3Spec.service.selector = { function: 'myFunction3' };
      nock(config.clusters[0].cluster.server)
        .get('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction3')
        .reply(404, JSON.stringify({ code: 404 }));
      nock(config.clusters[0].cluster.server)
        .post('/apis/kubeless.io/v1beta1/namespaces/default/functions/', {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'Function',
          metadata: {
            name: 'myFunction3',
            namespace: 'default',
            labels: { 'created-by': 'kubeless', function: 'myFunction3' },
            annotations: {},
          },
          spec: func3Spec,
        })
        .reply(200, postReply);
      return kubelessDeploy.deployFunction().catch(e => {
        expect(e.message).to.be.eql(
          'Found errors while processing the given functions:\n' +
          'Error: Unable to deploy the function myFunction2. Received:\n' +
          '  Code: 500\n' +
          '  Message: Internal server error'
        );
      }).then(() => {
        expect(functionsDeployed).to.be.eql([functionName, 'myFunction3']);
      });
    });
    it('should deploy a function using the given package', () => {
      kubelessDeploy = new KubelessDeploy(serverlessWithFunction, {
        package: path.join(cwd, 'package.zip'),
      });
      const content = 'different function content';
      const contentBase64 = new Buffer(content).toString('base64');
      const newChecksum = 'sha256:ec8a289c00b7789bc86115947f453bac88a40796b35e79ed5d5ef437b6579605';
      fs.writeFileSync(path.join(path.join(cwd, 'package.zip')), content);
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        function: contentBase64,
        checksum: newChecksum,
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should deploy a function with requirements', () => {
      fs.writeFileSync(depsFile, 'request');
      kubelessDeploy = instantiateKubelessDeploy(pkgFile, depsFile, serverlessWithFunction);
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'request',
      }));
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
      const content = 'different function content';
      const contentBase64 = new Buffer(content).toString('base64');
      const newChecksum = 'sha256:ec8a289c00b7789bc86115947f453bac88a40796b35e79ed5d5ef437b6579605';
      fs.writeFileSync(path.join(path.join(cwd, 'package.zip')), content);
      sinon.stub(kubelessDeploy, 'loadZip').returns({
        then: (f) => f({
          file: () => ({
            async: () => ({
              catch: () => ({ then: (ff) => ff('request') }),
            }),
          }),
        }),
      });
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'request',
        function: contentBase64,
        checksum: newChecksum,
      }));
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
    });
    it('should redeploy a function', () => {
      mocks.createDeploymentNocks(
        config.clusters[0].cluster.server, functionName, defaultFuncSpec(), {
          functionExists: true,
        }
      );
      nock(config.clusters[0].cluster.server)
        .patch(`/apis/kubeless.io/v1beta1/namespaces/default/functions/${functionName}`, {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'Function',
          metadata: {
            name: 'myFunction',
            namespace: 'default',
            labels: { 'created-by': 'kubeless', function: functionName },
            annotations: {},
          },
          spec: defaultFuncSpec(),
        })
        .reply(200, '{"message": "OK"}');
      kubelessDeploy.options.force = true;
      let result = null;
      result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction().then(() => {
          expect(nock.pendingMocks()).to.contain(
            /* eslint-disable max-len*/
            `POST ${config.clusters[0].cluster.server}/apis/kubeless.io/v1beta1/namespaces/default/functions/`
            /* eslint-enable max-len*/
          );
          expect(nock.pendingMocks()).to.not.contain(
            `PATCH ${config.clusters[0].cluster.server}/apis/kubeless.io/v1beta1/namespaces/default/functions/${functionName}` // eslint-disable-line max-len
          );
        })
      ).to.be.fulfilled;
      return result;
    });
    it('should fail if a redeployment returns an error code', () => {
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        deps: 'request',
      }), {
        functionExists: true,
      });
      nock(config.clusters[0].cluster.server)
        .patch(`/apis/kubeless.io/v1beta1/namespaces/default/functions/${functionName}`, {
          apiVersion: 'kubeless.io/v1beta1',
          kind: 'Function',
          metadata: {
            name: 'myFunction',
            namespace: 'default',
            labels: { 'created-by': 'kubeless', function: functionName },
            annotations: {},
          },
          spec: defaultFuncSpec(),
        })
        .reply(500, '{"code": 500, "message": "Internal server error"}');
      kubelessDeploy.options.force = true;
      return expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.eventually.rejectedWith(
        'Found errors while processing the given functions:\n' +
        'Error: Unable to update the function myFunction. Received:\n' +
        '  Code: 500\n' +
        '  Message: Internal server error'
        );
    });
    it('should deploy a function with a timeout (in the function)', () => {
      const serverlessWithCustomProperties = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomProperties.service.functions[functionName].timeout = 10;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomProperties
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        timeout: '10',
      }));
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with a timeout (in the provider)', () => {
      const serverlessWithCustomProperties = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomProperties.service.provider.timeout = 10;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomProperties
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        timeout: '10',
      }));
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
    it('should deploy a function with a custom port', () => {
      const serverlessWithCustomProperties = _.cloneDeep(serverlessWithFunction);
      serverlessWithCustomProperties.service.functions[functionName].port = 1234;
      kubelessDeploy = instantiateKubelessDeploy(
        pkgFile,
        depsFile,
        serverlessWithCustomProperties
      );
      mocks.createDeploymentNocks(config.clusters[0].cluster.server, functionName, defaultFuncSpec({
        service: {
          ports: [{
            name: 'http-function-port',
            port: 1234,
            protocol: 'TCP',
            targetPort: 1234,
          }],
          selector: {
            function: functionName,
          },
          type: 'ClusterIP',
        },
      }));
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessDeploy.deployFunction()
      ).to.be.fulfilled;
      return result;
    });
  });
});
