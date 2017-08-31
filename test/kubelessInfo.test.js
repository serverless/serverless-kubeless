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
const sinon = require('sinon');
const getServerlessObj = require('./lib/serverless');
const KubelessInfo = require('../info/kubelessInfo');

const func = 'my-function';
const serverless = getServerlessObj({ service: { functions: { 'my-function': {} } } });

require('chai').use(chaiAsPromised);

describe('KubelessInfo', () => {
  describe('#constructor', () => {
    const options = { test: 1 };
    const kubelessInfo = new KubelessInfo(serverless, options);
    let validateStub = null;
    let infoStub = null;
    const stubHooks = (kbInfo) => {
      validateStub = sinon.stub(kbInfo, 'validate').returns(BbPromise.resolve());
      infoStub = sinon.stub(kbInfo, 'infoFunction').returns(BbPromise.resolve());
    };
    const restoreHooks = (kbInfo) => {
      kbInfo.validate.restore();
      kbInfo.infoFunction.restore();
    };
    beforeEach(() => {
      stubHooks(kubelessInfo);
    });
    afterEach(() => {
      restoreHooks(kubelessInfo);
    });
    it('should set the serverless instance', () => {
      expect(kubelessInfo.serverless).to.be.eql(serverless);
    });
    it('should set options if provided', () => {
      expect(kubelessInfo.options).to.be.eql(options);
    });
    it('should set a provider ', () => {
      expect(kubelessInfo.provider).to.not.be.eql(undefined);
    });
    it('should have hooks', () => expect(kubelessInfo.hooks).to.be.not.empty);
    it('should run promise chain in order', () => kubelessInfo.hooks['info:info']().then(() => {
      expect(validateStub.calledOnce).to.be.equal(true);
      expect(infoStub.calledAfter(validateStub)).to.be.equal(true);
    }));
  });
  describe('#validate', () => {
    it('prints a message if an unsupported option is given', () => {
      const kubelessInfo = new KubelessInfo(serverless, { region: 'us-east1' });
      sinon.stub(serverless.cli, 'log');
      try {
        expect(() => kubelessInfo.validate()).to.not.throw();
        expect(serverless.cli.log.firstCall.args).to.be.eql(
          ['Warning: Option region is not supported for the kubeless plugin']
        );
      } finally {
        serverless.cli.log.restore();
      }
    });
  });
  function mockGetCalls(functions, functionModif) {
    sinon.stub(Api.Core.prototype, 'get').callsFake((p, ff) => {
      if (p.path[0] === '/api/v1/services') {
          // Mock call to get.services
        ff(null, {
          statusCode: 200,
          body: {
            items: _.map(functions, (f) => ({ metadata:
            { name: f.name,
              namespace: f.namespace,
              selfLink: `/api/v1/namespaces/${f.namespace}/services/${f.name}`,
              uid: '010a169d-618c-11e7-9939-080027abf356',
              resourceVersion: '248',
              creationTimestamp: '2017-07-05T14:12:39Z',
              labels: { function: f.name } },
              spec:
              { ports: [{ protocol: 'TCP', port: 8080, targetPort: 8080, nodePort: 30817 }],
                selector: { function: f.name },
                clusterIP: '10.0.0.177',
                type: 'NodePort',
                sessionAffinity: 'None' },
              status: { loadBalancer: {} } })),
          },
        });
      }
    });

    // Mock call to get.functions per namespace
    sinon.stub(Api.ThirdPartyResources.prototype, 'get').callsFake(function (p, ff) {
      const allFunctions = _.map(functions, (f) => (_.defaultsDeep({}, functionModif, {
        apiVersion: 'k8s.io/v1',
        kind: 'Function',
        metadata:
        {
          name: f.name,
          namespace: f.namespace,
          selfLink: `/apis/k8s.io/v1/namespaces/${f.namespace}/functions/${f.name}`,
          uid: '0105ba84-618c-11e7-9939-080027abf356',
          resourceVersion: '244',
          creationTimestamp: '2017-07-05T14:12:39Z',
        },
        spec: {
          deps: '',
          function: '',
          handler: `${f.name}.hello`,
          runtime: 'python2.7',
          topic: '',
          type: 'HTTP',
        },
      })));
      ff(null, {
        statusCode: 200,
        body: {
          items: _.filter(allFunctions, f => f.metadata.namespace === this.namespaces.namespace),
        },
      });
    });

    // Mock call to get.ingress
    sinon.stub(Api.Extensions.prototype, 'get').callsFake((p, ff) => {
      ff(null, {
        statusCode: 200,
        body: {
          items: _.compact(_.map(functions, (f) => {
            if (f.path) {
              return {
                metadata: {
                  labels: {
                    function: f.name,
                  },
                },
                spec: {
                  rules: [{ host: '1.2.3.4.nip.io', http: { paths: [{ path: f.path }] } }],
                },
                status: {
                  loadBalancer: {
                    ingress: [{ ip: '1.2.3.4' }],
                  },
                },
              };
            }
            return null;
          })),
        },
      });
    });
  }
  function infoMock(f) {
    return `\nService Information "${f}"\n` +
        'Cluster IP:  10.0.0.177\n' +
        'Type:  NodePort\n' +
        'Ports: \n' +
        '  Protocol:  TCP\n' +
        '  Port:  8080\n' +
        '  Target Port:  8080\n' +
        '  Node Port:  30817\n' +
        'Function Info\n' +
        `Handler:  ${f}.hello\n` +
        'Runtime:  python2.7\n' +
        'Trigger:  HTTP\n' +
        'Dependencies:  ';
  }


  describe('#printInfo', () => {
    beforeEach(() => {
      sinon.stub(helpers, 'loadKubeConfig').callsFake(loadKubeConfig);
    });
    afterEach(() => {
      Api.Core.prototype.get.restore();
      Api.ThirdPartyResources.prototype.get.restore();
      Api.Extensions.prototype.get.restore();
      helpers.loadKubeConfig.restore();
    });
    it('should return logs with the correct formating', () => {
      mockGetCalls([{ name: func, namespace: 'default' }]);
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      return expect(kubelessInfo.infoFunction({ color: false })).to.become(
        infoMock(func)
      );
    });
    it('should return info for functions in different namespaces', (done) => {
      mockGetCalls([
        { name: 'my-function-1', namespace: 'custom-1' },
        { name: 'my-function-2', namespace: 'custom-2' },
      ]);
      const serverlessWithNS = getServerlessObj({ service: {
        provider: {
          namespace: 'custom-1',
        },
        functions: {
          'my-function-1': {},
          'my-function-2': { namespace: 'custom-2' },
        },
      } });
      sinon.stub(helpers, 'getConnectionOptions');
      helpers.getConnectionOptions.onFirstCall().returns({ namespace: 'custom-1' });
      helpers.getConnectionOptions.onSecondCall().returns({ namespace: 'custom-2' });
      const kubelessInfo = new KubelessInfo(serverlessWithNS);
      kubelessInfo.infoFunction().then((message) => {
        expect(helpers.getConnectionOptions.callCount).to.be.eql(2);
        expect(helpers.getConnectionOptions.firstCall.args[1]).to.be.eql({
          namespace: 'custom-1',
        });
        expect(helpers.getConnectionOptions.secondCall.args[1]).to.be.eql(
          { namespace: 'custom-2' }
        );
        expect(message).to.be.eql(`${infoMock('my-function-1')}${infoMock('my-function-2')}`);
        helpers.getConnectionOptions.restore();
        done();
      });
    });
    it('should return info only for the functions defined in the current scope', (done) => {
      mockGetCalls([
        { name: 'my-function-1', namespace: 'custom-1' },
        { name: 'my-function-2', namespace: 'custom-2' },
      ]);
      const serverlessWithNS = getServerlessObj({
        service: {
          provider: {
            namespace: 'custom-1',
          },
          functions: {
            'my-function-1': {},
          },
        },
      });
      sinon.stub(helpers, 'getConnectionOptions');
      helpers.getConnectionOptions.onFirstCall().returns({ namespace: 'custom-1' });
      const kubelessInfo = new KubelessInfo(serverlessWithNS);
      kubelessInfo.infoFunction().then((message) => {
        expect(helpers.getConnectionOptions.callCount).to.be.eql(1);
        expect(helpers.getConnectionOptions.firstCall.args[1]).to.be.eql({
          namespace: 'custom-1',
        });
        expect(message).to.be.eql(`${infoMock('my-function-1')}`);
        helpers.getConnectionOptions.restore();
        done();
      });
    });
    it('should return an error message if no function is found', (done) => {
      mockGetCalls([]);
      const serverlessWithNS = getServerlessObj({
        service: {
          provider: {
            namespace: 'custom-1',
          },
          functions: {
            'my-function-1': {},
          },
        },
      });
      sinon.stub(helpers, 'getConnectionOptions');
      sinon.stub(serverlessWithNS.cli, 'consoleLog');
      helpers.getConnectionOptions.onFirstCall().returns({ namespace: 'custom-1' });
      const kubelessInfo = new KubelessInfo(serverlessWithNS);
      kubelessInfo.infoFunction().then(() => {
        expect(helpers.getConnectionOptions.callCount).to.be.eql(1);
        expect(helpers.getConnectionOptions.firstCall.args[1]).to.be.eql({
          namespace: 'custom-1',
        });
        expect(serverlessWithNS.cli.consoleLog.callCount).to.be.eql(1);
        expect(serverlessWithNS.cli.consoleLog.firstCall.args[0]).to.be.eql(
          'Not found any information about the function "my-function-1"'
        );
        helpers.getConnectionOptions.restore();
        done();
      });
    });
    it('should return the trigger topic in case it exists', (done) => {
      mockGetCalls(
        [{ name: func, namespace: 'default' }],
        { spec: { type: 'PubSub', topic: 'test_topic' } }
      );
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.match(/Topic Trigger: test_topic/);
        done();
      });
    });
    it('should return the description in case it exists', (done) => {
      mockGetCalls(
        [{ name: func, namespace: 'default' }],
        { annotations: { 'kubeless.serverless.com/description': 'Test Description' } }
      );
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.match(/Description: Test Description/);
        done();
      });
    });
    it('should return the labels in case they exist', (done) => {
      mockGetCalls(
        [{ name: func, namespace: 'default' }],
        { labels: { label1: 'text1', label2: 'text2' } }
      );
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.match(/Labels:\n {2}label1: text1\n {2}label2: text2\n/);
        done();
      });
    });
    it('should return the URL in case a path is specified', (done) => {
      mockGetCalls([{ name: func, namespace: 'default', path: '/hello' }]);
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.match(/URL: {2}1.2.3.4.nip.io\/hello\n/);
        done();
      });
    });
  });
});
