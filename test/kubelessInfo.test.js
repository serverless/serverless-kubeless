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

const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const helpers = require('../lib/helpers');
const loadKubeConfig = require('./lib/load-kube-config');
const sinon = require('sinon');

const KubelessInfo = require('../info/kubelessInfo');
const serverless = require('./lib/serverless');

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
  describe('#printInfo', () => {
    const func = 'my-function';
    beforeEach(() => {
      sinon.stub(Api.Core.prototype, 'get').callsFake((p, ff) => {
        if (p.path[0] === '/api/v1/services') {
          // Mock call to get.services
          ff(null, {
            statusCode: 200,
            body: {
              items: [{ metadata:
              { name: func,
                namespace: 'default',
                selfLink: `/api/v1/namespaces/default/services/${func}`,
                uid: '010a169d-618c-11e7-9939-080027abf356',
                resourceVersion: '248',
                creationTimestamp: '2017-07-05T14:12:39Z',
                labels: { function: func } },
                spec:
                { ports: [{ protocol: 'TCP', port: 8080, targetPort: 8080, nodePort: 30817 }],
                  selector: { function: func },
                  clusterIP: '10.0.0.177',
                  type: 'NodePort',
                  sessionAffinity: 'None' },
                status: { loadBalancer: {} } }],
            },
          });
        }
      });
      sinon.stub(Api.ThirdPartyResources.prototype, 'get').callsFake((p, ff) => {
          // Mock call to get.functions
        ff(null, {
          statusCode: 200,
          body: {
            items: [{ apiVersion: 'k8s.io/v1',
              kind: 'Function',
              metadata:
              { name: func,
                namespace: 'default',
                selfLink: `/apis/k8s.io/v1/namespaces/default/functions/${func}`,
                uid: '0105ba84-618c-11e7-9939-080027abf356',
                resourceVersion: '244',
                creationTimestamp: '2017-07-05T14:12:39Z' },
              spec:
              { deps: '',
                function: '',
                handler: `${func}.hello`,
                runtime: 'python2.7',
                topic: '',
                type: 'HTTP' } }],
          },
        });
      });
      sinon.stub(helpers, 'loadKubeConfig').callsFake(loadKubeConfig);
    });
    afterEach(() => {
      Api.Core.prototype.get.restore();
      Api.ThirdPartyResources.prototype.get.restore();
      helpers.loadKubeConfig.restore();
    });
    it('should return logs with the correct formating', () => {
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      return expect(kubelessInfo.infoFunction({ color: false })).to.become(
        '\nService Information "my-function"\n' +
        'Cluster IP:  10.0.0.177\n' +
        'Type:  NodePort\n' +
        'Ports: \n' +
        '  Protocol:  TCP\n' +
        '  Port:  8080\n' +
        '  Target Port:  8080\n' +
        '  Node Port:  30817\n' +
        'Function Info\n' +
        `Handler:  ${func}.hello\n` +
        'Runtime:  python2.7\n' +
        'Topic:  \n' +
        'Dependencies:  \n'
      );
    });
  });
});
