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
const helpers = require('../lib/helpers');
const loadKubeConfig = require('./lib/load-kube-config');
const fs = require('fs');
const moment = require('moment');
const os = require('os');
const path = require('path');
const sinon = require('sinon');
const rm = require('./lib/rm');

const KubelessRemove = require('../remove/kubelessRemove');
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
      fs.writeFileSync(path.join(cwd, 'function.py'), 'function code');
      sinon.stub(Api.ThirdPartyResources.prototype, 'delete');
      sinon.stub(Api.Extensions.prototype, 'delete');
      sinon.stub(Api.Extensions.prototype, 'get');
      Api.ThirdPartyResources.prototype.delete.callsFake((data, ff) => {
        ff(null, { statusCode: 200 });
      });
      // Api.Extensions.prototype.get.callsFake((data, ff) => {
      //   ff(null, { statusCode: 200, body: { items: [] } });
      // });
      Api.Extensions.prototype.delete.callsFake((data, ff) => {
        ff(null, { statusCode: 200 });
      });
      sinon.stub(helpers, 'loadKubeConfig').callsFake(loadKubeConfig);
    });
    afterEach(() => {
      Api.ThirdPartyResources.prototype.delete.restore();
      Api.Extensions.prototype.delete.restore();
      Api.Extensions.prototype.get.restore();
      helpers.loadKubeConfig.restore();
      rm(cwd);
    });
    it('should remove a function', () => {
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.fulfilled;
      expect(Api.ThirdPartyResources.prototype.delete.calledOnce).to.be.eql(true);
      expect(
        Api.ThirdPartyResources.prototype.delete.firstCall.args[0].path[1]
      ).to.be.eql('myFunction');
      expect(Api.ThirdPartyResources.prototype.delete.firstCall.args[1]).to.be.a('function');
    });
    it('should skip a removal if an error 404 is returned', () => {
      Api.ThirdPartyResources.prototype.delete.callsFake((data, ff) => {
        ff({ code: 404 });
      });
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.fulfilled;
      expect(serverlessWithFunction.cli.log.lastCall.args).to.be.eql(
        ['The function myFunction doesn\'t exist. Skipping removal.']
      );
    });
    it('should fail if a removal returns an error code', () => {
      Api.ThirdPartyResources.prototype.delete.callsFake((data, ff) => {
        ff({ code: 500, message: 'Internal server error' });
      });
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.eventually.rejectedWith(
        'Found errors while removing the given functions:\n' +
        'Unable to remove the function myFunction. Received:\n' +
        '  Code: 500\n' +
        '  Message: Internal server error'
      );
    });
    it('should remove the possible functions even if one of them fails', () => {
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
      const functionsRemoved = [];
      Api.ThirdPartyResources.prototype.delete.onFirstCall().callsFake((data, ff) => {
        functionsRemoved.push(data.path[1]);
        ff(null, { statusCode: 200 });
      });
      Api.ThirdPartyResources.prototype.delete.onSecondCall().callsFake((data, ff) => {
        ff({ code: 500, message: 'Internal server error' });
      });
      Api.ThirdPartyResources.prototype.delete.onThirdCall().callsFake((data, ff) => {
        functionsRemoved.push(data.path[1]);
        ff(null, { statusCode: 200 });
      });
      kubelessRemove = new KubelessRemove(serverlessWithFunctions);
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.eventually.rejectedWith(
        'Found errors while removing the given functions:\n' +
        'Unable to remove the function myFunction2. Received:\n' +
        '  Code: 500\n' +
        '  Message: Internal server error'
      );
      expect(functionsRemoved).to.be.eql(['myFunction1', 'myFunction3']);
    });
    it('calls Kubernetes API with the correct namespace (in provider)', () => {
      const serverlessWithNS = _.cloneDeep(serverlessWithFunction);
      serverlessWithNS.service.provider.namespace = 'test';
      kubelessRemove = new KubelessRemove(serverlessWithNS);
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.fulfilled;
      expect(Api.ThirdPartyResources.prototype.delete.calledOnce).to.be.eql(true);
      expect(
        Api.ThirdPartyResources.prototype.delete.firstCall.args[0].path[0]
      ).to.be.eql('/apis/k8s.io/v1/namespaces/test/functions');
    });
    it('calls Kubernetes API with the correct namespace (in function)', () => {
      const serverlessWithNS = _.cloneDeep(serverlessWithFunction);
      serverlessWithNS.service.functions.myFunction.namespace = 'test';
      kubelessRemove = new KubelessRemove(serverlessWithNS);
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.fulfilled;
      expect(Api.ThirdPartyResources.prototype.delete.calledOnce).to.be.eql(true);
      expect(
        Api.ThirdPartyResources.prototype.delete.firstCall.args[0].path[0]
      ).to.be.eql('/apis/k8s.io/v1/namespaces/test/functions');
    });
    it('should remove the ingress controller if exists', () => {
      Api.Extensions.prototype.get.callsFake((data, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [
              { metadata: { labels: { myFunction: '1' } } },
            ],
          },
        });
      });
      const serverlessWithIngress = _.cloneDeep(serverlessWithFunction);
      serverlessWithIngress.service.functions.myFunction.events = [{
        http: null,
        path: '/test',
      }];
      kubelessRemove = new KubelessRemove(serverlessWithIngress, { verbose: false });
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.fulfilled;
      expect(Api.Extensions.prototype.delete.calledOnce).to.be.eql(true);
      expect(
        Api.Extensions.prototype.delete.firstCall.args[0].path[0]
      ).to.be.eql('/apis/extensions/v1beta1/namespaces/default/ingresses');
    });
    it('should remove the ingress controller if exists (with a different namespace)', () => {
      Api.Extensions.prototype.get.callsFake((data, ff) => {
        ff(null, {
          statusCode: 200,
          body: {
            items: [
              { metadata: { labels: { myFunction: '1' } } },
            ],
          },
        });
      });
      const serverlessWithIngress = _.cloneDeep(serverlessWithFunction);
      serverlessWithIngress.service.functions.myFunction.events = [{
        http: null,
        path: '/test',
      }];
      serverlessWithIngress.service.functions.myFunction.namespace = 'test';
      kubelessRemove = new KubelessRemove(serverlessWithIngress, { verbose: false });
      expect( // eslint-disable-line no-unused-expressions
        kubelessRemove.removeFunction(cwd)
      ).to.be.fulfilled;
      expect(Api.Extensions.prototype.delete.calledOnce).to.be.eql(true);
      expect(
        Api.Extensions.prototype.delete.firstCall.args[0].path[0]
      ).to.be.eql('/apis/extensions/v1beta1/namespaces/test/ingresses');
    });
  });
});
