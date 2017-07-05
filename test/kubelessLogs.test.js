'use strict';

const _ = require('lodash');
const Api = require('kubernetes-client');
const BbPromise = require('bluebird');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const helpers = require('../lib/helpers');
const moment = require('moment');
const sinon = require('sinon');

const KubelessLogs = require('../logs/kubelessLogs');
const serverless = require('./lib/serverless');

require('chai').use(chaiAsPromised);

describe('KubelessLogs', () => {
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
    let kubelessLogs = new KubelessLogs(serverless, options);
    let validateStub = null;
    let logsStub = null;
    const stubHooks = (kbLogs) => {
      validateStub = sinon.stub(kbLogs, 'validate').returns(BbPromise.resolve());
      logsStub = sinon.stub(kbLogs, 'printLogs').returns(BbPromise.resolve());
    };
    const restoreHooks = (kbLogs) => {
      kbLogs.validate.restore();
      kbLogs.printLogs.restore();
    };
    beforeEach(() => {
      stubHooks(kubelessLogs);
    });
    afterEach(() => {
      restoreHooks(kubelessLogs);
    });
    it('should set the serverless instance', () => {
      expect(kubelessLogs.serverless).to.be.eql(serverless);
    });
    it('should set options if provided', () => {
      expect(kubelessLogs.options).to.be.eql(options);
    });
    it('should set a provider ', () => {
      expect(kubelessLogs.provider).to.not.be.eql(undefined);
    });
    it('should have hooks', () => expect(kubelessLogs.hooks).to.be.not.empty);
    it('should run promise chain in order', () => kubelessLogs.hooks['logs:logs']().then(() => {
      expect(validateStub.calledOnce).to.be.equal(true);
      expect(logsStub.calledAfter(validateStub)).to.be.equal(true);
    }));
    it('iterate printing logs if tail option is provided (each 1000 ms)', () => {
      kubelessLogs = new KubelessLogs(serverless, { tail: true });
      stubHooks(kubelessLogs);
      const clock = sinon.useFakeTimers();
      kubelessLogs.hooks['logs:logs']().then(() => {
        clock.tick(2100);
        // It should be executed one initial time plus two times after 2 seconds
        expect(kubelessLogs.printLogs.callCount).to.be.equal(3);
      });
    });
    it('iterate printing logs if tail option is provided (custom interval)', () => {
      kubelessLogs = new KubelessLogs(serverless, { tail: true, interval: 2000 });
      stubHooks(kubelessLogs);
      const clock = sinon.useFakeTimers();
      kubelessLogs.hooks['logs:logs']().then(() => {
        clock.tick(2100);
        // It should be executed one initial time plus another time after 2 seconds
        expect(kubelessLogs.printLogs.callCount).to.be.equal(2);
      });
    });
  });
  describe('#validate', () => {
    it('throws an error if the variable KUBE_API_URL is not set', () => {
      const kubelessLogs = new KubelessLogs(serverless);
      delete process.env.KUBE_API_URL;
      expect(() => kubelessLogs.validate()).to.throw(
        'Please specify the Kubernetes API server IP as the environment variable KUBE_API_URL'
      );
    });
    it('prints a message if an unsupported option is given', () => {
      const kubelessLogs = new KubelessLogs(serverless, { region: 'us-east1' });
      sinon.stub(serverless.cli, 'log');
      try {
        expect(() => kubelessLogs.validate()).to.not.throw();
        expect(serverless.cli.log.firstCall.args).to.be.eql(
          ['Warning: Option region is not supported for the kubeless plugin']
        );
      } finally {
        serverless.cli.log.restore();
      }
    });
  });
  describe('#printLogs', () => {
    const f = 'my-function';
    const pod = 'my-pod';
    /* eslint-disable max-len */
    const logsSample =
      // Yesterday
      `172.17.0.1 - - [${moment().subtract('1', 'd').format('DD/MMM/YYYY:hh:mm:ss')} +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/95\n` +
      // One hour before
      `172.17.0.1 - - [${moment().subtract('1', 'h').format('DD/MMM/YYYY:hh:mm:ss')} +0000] "POST / HTTP/1.1" 500 742 "" "" 0/484\n` +
      // One minute before
      `172.17.0.1 - - [${moment().subtract('1', 'm').format('DD/MMM/YYYY:hh:mm:ss')} +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/84`;
    /* eslint-enable max-len */

    beforeEach(() => {
      sinon.stub(Api.Core.prototype, 'get').callsFake((p, ff) => {
        if (p.path[0] === '/api/v1/namespaces/default/pods') {
          // Mock call to get.pods
          ff(null, {
            statusCode: 200,
            body: {
              items: [{
                metadata: { name: pod, labels: { function: f } },
              }],
            },
          });
        }
        if (p.path[0] === `/api/v1/namespaces/default/pods/${pod}/log`) {
          // Mock call to pods('my-function').log.get
          ff(null,
            {
              statusCode: 200,
              body: logsSample,
            }
          );
        }
      });
    });
    afterEach(() => {
      Api.Core.prototype.get.restore();
    });
    it('should print the function logs', () => {
      const kubelessLogs = new KubelessLogs(serverless, { function: f });
      expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample);
    });
    it('should throw an error if the the function has not been deployed', () => {
      const kubelessLogs = new KubelessLogs(serverless, { function: 'test' });
      expect(kubelessLogs.printLogs()).to.be.eventually.rejectedWith(
        'Unable to find the pod for the function test'
      );
    });
    it('should filter a specific number of log lines', () => {
      const kubelessLogs = new KubelessLogs(serverless, { count: 1, function: f });
      expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[2]);
    });
    it('should filter a lines with a pattern', () => {
      const kubelessLogs = new KubelessLogs(serverless, { filter: 'POST', function: f });
      expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[1]);
    });
    it('should filter a lines with a start time as a date string', () => {
      const kubelessLogs = new KubelessLogs(serverless, {
        // In the last two minutes
        startTime: moment().subtract('2', 'm').format(),
        function: f,
      });
      // Should return last entry
      expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[2]);
    });
    it('should filter a lines with a start time as a number', () => {
      const kubelessLogs = new KubelessLogs(serverless, {
        // In the last two minutes
        startTime: moment().subtract('2', 'm').valueOf(),
        function: f,
      });
      // Should return last entry
      expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[2]);
    });
    it('should filter a lines from a period of time', () => {
      const kubelessLogs = new KubelessLogs(serverless, {
        // In the last two hours
        startTime: '2h',
        function: f,
      });
      // Should return last two entries
      expect(kubelessLogs.printLogs({ silent: true })).to.become(
        logsSample.split('\n').slice(1).join('\n')
      );
    });
    it('should not print anything if there are no entries that pass the filter', () => {
      sinon.stub(console, 'log');
      try {
        const kubelessLogs = new KubelessLogs(serverless, {
          // Right now
          startTime: moment().format(),
          function: f,
        });
        expect(kubelessLogs.printLogs({ silent: true })).to.become([]);
        expect(console.log.callCount).to.be.eql(0);
      } finally {
        console.log.restore();
      }
    });
  });
});
