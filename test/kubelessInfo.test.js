'use strict';

const _ = require('lodash');
const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const helpers = require('../lib/helpers');
const sinon = require('sinon');

const KubelessInfo = require('../info/kubelessInfo');
const serverless = require('./lib/serverless');

require('chai').use(chaiAsPromised);

describe('KubelessInfo', () => {
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
    it('throws an error if the variable KUBE_API_URL is not set', () => {
      const kubelessInfo = new KubelessInfo(serverless);
      delete process.env.KUBE_API_URL;
      expect(() => kubelessInfo.validate()).to.throw(
        'Please specify the Kubernetes API server IP as the environment variable KUBE_API_URL'
      );
    });
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
    });
    afterEach(() => {
      Api.Core.prototype.get.restore();
      Api.ThirdPartyResources.prototype.get.restore();
    });
    it('should return logs with the correct formating', () => {
      const kubelessInfo = new KubelessInfo(serverless, { function: func });
      // console.log(kubelessInfo.infoFunction({ color: false })._rejectionHandler0);
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
