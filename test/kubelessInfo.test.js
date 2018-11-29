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
const mocks = require('./lib/mocks');
const nock = require('nock');
const os = require('os');
const path = require('path');
const rm = require('./lib/rm');
const sinon = require('sinon');
const getServerlessObj = require('./lib/serverless');
const KubelessInfo = require('../info/kubelessInfo');

const func = 'my-function';
const serviceName = 'test';
const serverless = getServerlessObj(
  { service: { service: serviceName, functions: { 'my-function': {} } } }
);

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
      expect(() => kubelessInfo.validate()).to.not.throw();
      expect(serverless.cli.log.firstCall.args).to.be.eql(
          ['Warning: Option region is not supported for the kubeless plugin']
        );
    });
  });
  function mockGetCalls(config, functions, functionModif) {
    const namespaces = _.map(functions, f => f.namespace);
    _.each(namespaces, ns => {
      nock(config.clusters[0].cluster.server)
        .get(`/api/v1/namespaces/${ns}/services`)
        .reply(200, {
          items: _.map(_.filter(functions, (f) => f.namespace === ns), (f) => ({
            metadata:
            {
              name: f.id,
              namespace: f.namespace,
              selfLink: `/api/v1/namespaces/${f.namespace}/services/${f.id}`,
              uid: '010a169d-618c-11e7-9939-080027abf356',
              resourceVersion: '248',
              creationTimestamp: '2017-07-05T14:12:39Z',
              labels: { function: f.id },
            },
            spec:
            {
              ports: [{ protocol: 'TCP', port: 8080, targetPort: 8080, nodePort: 30817 }],
              selector: { function: f.id },
              clusterIP: '10.0.0.177',
              type: 'NodePort',
              sessionAffinity: 'None',
            },
            status: { loadBalancer: {} },
          })),
        })
        .persist();
    });

    // Mock call to get.functions per namespace
    const allFunctions = _.map(functions, (f) => (_.defaultsDeep({}, functionModif, {
      apiVersion: 'kubeless.io/v1beta1',
      kind: 'Function',
      metadata:
      {
        name: f.id,
        namespace: f.namespace,
        selfLink: `/apis/kubeless.io/v1beta1/namespaces/${f.namespace}/functions/${f.id}`,
        uid: '0105ba84-618c-11e7-9939-080027abf356',
        resourceVersion: '244',
        creationTimestamp: '2017-07-05T14:12:39Z',
      },
      spec: {
        deps: '',
        function: '',
        handler: `${f.id}.hello`,
        runtime: 'python2.7',
      },
    })));
    _.each(functions, f => {
      nock(config.clusters[0].cluster.server)
        .get(`/apis/kubeless.io/v1beta1/namespaces/${f.namespace}/functions/${f.id}`)
        .reply(200, _.find(allFunctions, (ff) => ff.metadata.name === f.id));
    });


    // Mock call to get.ingress
    _.each(functions, f => {
      nock(config.clusters[0].cluster.server)
        .get(`/apis/extensions/v1beta1/namespaces/${f.namespace}/ingresses/${serviceName}`)
        .reply(200, f.path ? {
          spec: {
            rules: [{
              host: '1.2.3.4.nip.io',
              http: {
                paths: [{
                  path: f.path,
                  backend: { serviceName: f.id },
                }],
              },
            }],
          },
          status: {
            loadBalancer: {
              ingress: [{ ip: '1.2.3.4' }],
            },
          },
        } : null);
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
        'Dependencies:  \n';
  }


  describe('#printInfo', () => {
    let config = null;
    let cwd = null;

    beforeEach(() => {
      cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
      config = mocks.kubeConfig(cwd);
    });
    afterEach(() => {
      rm(cwd);
      nock.cleanAll();
    });
    it('should return logs with the correct formating', () => {
      mockGetCalls(config, [
        { id: func, namespace: 'default' }, 
        { id: 'my-function-1', namespace: 'custom-1' }
      ]);
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      return expect(kubelessInfo.infoFunction({ color: false })).to.become(
        infoMock(func)
      );
    });
    it('should return info for functions in different namespaces', (done) => {
      mockGetCalls(config, [
        { id: 'my-function-1', namespace: 'custom-1' },
        { id: 'my-function-2', namespace: 'custom-2' },
      ]);
      const serverlessWithNS = getServerlessObj({ service: {
        service: serviceName,
        provider: {
          namespace: 'custom-1',
        },
        functions: {
          'my-function-1': {},
          'my-function-2': { namespace: 'custom-2' },
        },
      } });
      const kubelessInfo = new KubelessInfo(serverlessWithNS);
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.be.eql(`${infoMock('my-function-1')}${infoMock('my-function-2')}`);
        done();
      });
    });
    it('should return info only for the functions defined in the current scope', (done) => {
      mockGetCalls(config, [
        { id: 'my-function-1', namespace: 'custom-1' },
        { id: 'my-function-2', namespace: 'custom-2' },
      ]);
      const serverlessWithNS = getServerlessObj({
        service: {
          service: serviceName,
          provider: {
            namespace: 'custom-1',
          },
          functions: {
            'my-function-1': {},
          },
        },
      });
      const kubelessInfo = new KubelessInfo(serverlessWithNS);
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.be.eql(`${infoMock('my-function-1')}`);
        done();
      });
    });
    it('should return an error message if no function is found', (done) => {
      mockGetCalls(config, [{ id: 'other-function', namespace: 'custom-1' }]);
      nock(config.clusters[0].cluster.server)
        .get('/apis/kubeless.io/v1beta1/namespaces/custom-1/functions/my-function-1')
        .reply(404, { code: 404 });
      nock(config.clusters[0].cluster.server)
        .get(`/apis/extensions/v1beta1/namespaces/custom-1/ingresses/${serviceName}`)
        .reply(404, 'not found');
      const serverlessWithNS = getServerlessObj({
        service: {
          service: serviceName,
          provider: {
            namespace: 'custom-1',
          },
          functions: {
            'my-function-1': {},
          },
        },
      });
      sinon.stub(serverlessWithNS.cli, 'consoleLog');
      const kubelessInfo = new KubelessInfo(serverlessWithNS);
      kubelessInfo.infoFunction().then(() => {
        expect(serverlessWithNS.cli.consoleLog.callCount).to.be.eql(1);
        expect(serverlessWithNS.cli.consoleLog.firstCall.args[0]).to.be.eql(
          'Not found any information about the function "my-function-1"'
        );
        done();
      });
    });
    it('should return the description in case it exists', (done) => {
      mockGetCalls(
        config,
        [{ id: func, namespace: 'default' }],
        { metadata: { annotations: { 'kubeless.serverless.com/description': 'Test Description' } } }
      );
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.match(/Description: Test Description/);
        done();
      });
    });
    it('should return the labels in case they exist', (done) => {
      mockGetCalls(
        config,
        [{ id: func, namespace: 'default' }],
        { metadata: { labels: { label1: 'text1', label2: 'text2' } } }
      );
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.match(/Labels:\n {2}label1: text1\n {2}label2: text2\n/);
        done();
      });
    });
    it('should return the URL in case a path is specified', (done) => {
      mockGetCalls(config, [{ id: func, namespace: 'default', path: '/hello' }]);
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      kubelessInfo.infoFunction({ color: false }).then((message) => {
        expect(message).to.match(/URL: {2}1.2.3.4.nip.io\/hello\n/);
        done();
      });
    });
  });
});
