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
const mocks = require('./lib/mocks');
const moment = require('moment');
const nock = require('nock');
const os = require('os');
const path = require('path');
const sinon = require('sinon');
const rm = require('./lib/rm');

const KubelessRemove = require('../remove/kubelessRemove');
const remove = require('../lib/remove');
const serverless = require('./lib/serverless')();

require('chai').use(chaiAsPromised);

describe('KubelessRemove', () => {
  describe('#constructor', () => {
    const options = { test: 1 };
    const kubelessRemove = new KubelessRemove(serverless, options);
    let validateStub = null;
    let removeStub = null;
    const stubHooks = (kbRemove) => {
      validateStub = sinon.stub(kbRemove, 'validate').returns(BbPromise.resolve());
      removeStub = sinon.stub(kbRemove, 'removeFunction').returns(BbPromise.resolve());
    };
    const restoreHooks = (kbRemove) => {
      kbRemove.validate.restore();
      kbRemove.removeFunction.restore();
    };
    beforeEach(() => {
      stubHooks(kubelessRemove);
    });
    afterEach(() => {
      restoreHooks(kubelessRemove);
    });
    it('should set the serverless instance', () => {
      expect(kubelessRemove.serverless).to.be.eql(serverless);
    });
    it('should set options if provided', () => {
      expect(kubelessRemove.options).to.be.eql(options);
    });
    it('should set a provider ', () => {
      expect(kubelessRemove.provider).to.not.be.eql(undefined);
    });
    it('should have hooks', () => expect(kubelessRemove.hooks).to.be.not.empty);
    it(
      'should run promise chain in order',
      () => kubelessRemove.hooks['remove:remove']().then(() => {
        expect(validateStub.calledOnce).to.be.equal(true);
        expect(removeStub.calledAfter(validateStub)).to.be.equal(true);
      })
    );
  });
  describe('#validate', () => {
    it('prints a message if an unsupported option is given', () => {
      const kubelessRemove = new KubelessRemove(serverless, { region: 'us-east1' });
      expect(() => kubelessRemove.validate()).to.not.throw();
      expect(serverless.cli.log.firstCall.args).to.be.eql(
        ['Warning: Option region is not supported for the kubeless plugin']
      );
    });
  });
  describe('#remove', () => {
    let config = null;
    let cwd = null;
    let serverlessWithFunction = null;
    let kubelessRemove = null;

    beforeEach(() => {
      serverlessWithFunction = _.defaultsDeep({}, serverless, {
        service: {
          functions: {
            myFunction: {
              handler: 'function.hello',
            },
          },
        },
      });
      kubelessRemove = new KubelessRemove(serverlessWithFunction);
      cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
      config = mocks.kubeConfig(cwd);
      fs.writeFileSync(path.join(cwd, 'function.py'), 'function code');
      sinon.stub(Api.Extensions.prototype, 'delete');
      sinon.stub(Api.Extensions.prototype, 'get');
      Api.Extensions.prototype.get.callsFake((data, ff) => {
        ff(null, { statusCode: 200, body: { items: [] } });
      });
      Api.Extensions.prototype.delete.callsFake((data, ff) => {
        ff(null, { statusCode: 200 });
      });
    });
    afterEach(() => {
      nock.cleanAll();
      Api.Extensions.prototype.delete.restore();
      Api.Extensions.prototype.get.restore();
      rm(cwd);
    });
    it('should remove a function', () => {
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction')
        .reply(200, {});
      const result = expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd).then(() => {
          expect(nock.pendingMocks()).to.not.contain('DELETE http://1.2.3.4:4433/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction');
        })
      ).to.be.fulfilled;
      return result;
    });
    it('should skip a removal if an error 404 is returned', () => {
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction')
        .reply(404, { code: 404 });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd).then(() => {
          expect(nock.pendingMocks()).to.not.contain('DELETE http://1.2.3.4:4433/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction');
        })
      ).to.be.fulfilled;
    });
    it('should fail if a removal returns an error code', () => {
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction')
        .reply(500, { code: 500, message: 'Internal server error' });
      return expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.eventually.rejectedWith('Internal server error');
    });
    it('should remove the possible functions even if one of them fails', (done) => {
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
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction1')
        .reply(200, {});
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction2')
        .reply(500, { code: 500, message: 'Internal server error' });
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction3')
        .reply(200, {});
      kubelessRemove = new KubelessRemove(serverlessWithFunctions);
      kubelessRemove.removeFunction(cwd).catch(e => {
        expect(e.message).to.contain('Message: Internal server error');
        expect(nock.pendingMocks()).to.be.eql([]);
        done();
      });
    });
    it('calls Kubernetes API with the correct namespace (in provider)', () => {
      const serverlessWithNS = _.cloneDeep(serverlessWithFunction);
      serverlessWithNS.service.provider.namespace = 'test';
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/test/functions/myFunction')
        .reply(200, {});
      kubelessRemove = new KubelessRemove(serverlessWithNS);
      return expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd).then(() => {
          expect(nock.pendingMocks()).to.be.eql([]);
        })
      ).to.be.fulfilled;
    });
    it('calls Kubernetes API with the correct namespace (in function)', () => {
      const serverlessWithNS = _.cloneDeep(serverlessWithFunction);
      serverlessWithNS.service.functions.myFunction.namespace = 'test';
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/test/functions/myFunction')
        .reply(200, {});
      kubelessRemove = new KubelessRemove(serverlessWithNS);
      return expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd).then(() => {
          expect(nock.pendingMocks()).to.be.eql([]);
        })
      ).to.be.fulfilled;
    });
    it('should remove the ingress controller if exists', () => {
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/default/functions/myFunction')
        .reply(200, {});
      const apiExtensions = new Api.Extensions(
        helpers.getConnectionOptions(helpers.loadKubeConfig(), { namespace: 'default' })
      );
      const functions = [{
        id: 'myFunction',
        handler: 'function.hello',
        events: [{ http: { path: '/test' } }],
      }];
      const serviceName = 'test';
      return expect( // eslint-disable-line no-unused-expressions
        remove(functions, serviceName, {
          apiExtensions, log: () => {},
        }).then(() => {
          expect(Api.Extensions.prototype.delete.calledOnce).to.be.eql(true);
          expect(
            Api.Extensions.prototype.delete.firstCall.args[0].path[0]
          ).to.be.eql('/apis/extensions/v1beta1/namespaces/default/ingresses');
        })
      ).to.be.fulfilled;
    });
    it('should remove the ingress controller if exists (with a different namespace)', () => {
      nock(config.clusters[0].cluster.server)
        .delete('/apis/kubeless.io/v1beta1/namespaces/test/functions/myFunction')
        .reply(200, {});
      const apiExtensions = new Api.Extensions(
        helpers.getConnectionOptions(helpers.loadKubeConfig(), { namespace: 'test' })
      );
      const functions = [{
        id: 'myFunction',
        handler: 'function.hello',
        events: [{ http: { path: '/test' } }],
      }];
      const serviceName = 'test';
      return expect( // eslint-disable-line no-unused-expressions
        remove(functions, serviceName, {
          apiExtensions, namespace: 'test', log: () => { },
        }).then(() => {
          expect(Api.Extensions.prototype.delete.calledOnce).to.be.eql(true);
          expect(
            Api.Extensions.prototype.delete.firstCall.args[0].path[0]
          ).to.be.eql('/apis/extensions/v1beta1/namespaces/test/ingresses');
        })
      ).to.be.fulfilled;
    });
  });
});
