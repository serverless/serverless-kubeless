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
const moment = require('moment');
const request = require('request');
const sinon = require('sinon');

const KubelessLogs = require('../logs/kubelessLogs');
const serverless = require('./lib/serverless');

require('chai').use(chaiAsPromised);

describe('KubelessLogs', () => {
  describe('#constructor', () => {
    const options = { test: 1 };
    const kubelessLogs = new KubelessLogs(serverless, options);
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
    it('should have hooks', () => expect(kubelessLogs.hooks).to.not.be.empty);
    it('should run promise chain in order', () => kubelessLogs.hooks['logs:logs']().then(() => {
      expect(validateStub.calledOnce).to.be.equal(true);
      expect(logsStub.calledAfter(validateStub)).to.be.equal(true);
    }));
  });
  describe('#validate', () => {
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
      `172.17.0.1 - - [${moment().utc().subtract('1', 'd').format('DD/MMM/YYYY:HH:mm:ss')} +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/95\n` +
      // One hour before
      `172.17.0.1 - - [${moment().utc().subtract('1', 'h').format('DD/MMM/YYYY:HH:mm:ss')} +0000] "POST / HTTP/1.1" 500 742 "" "" 0/484\n` +
      // One minute before
      `172.17.0.1 - - [${moment().utc().subtract('1', 'm').format('DD/MMM/YYYY:HH:mm:ss')} +0000] "GET /healthz HTTP/1.1" 200 2 "" "Go-http-client/1.1" 0/84`;
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
      sinon.stub(helpers, 'loadKubeConfig').callsFake(loadKubeConfig);
    });
    afterEach(() => {
      Api.Core.prototype.get.restore();
      helpers.loadKubeConfig.restore();
    });
    it('should print the function logs', () => {
      const kubelessLogs = new KubelessLogs(serverless, { function: f });
      return expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample);
    });
    it('should throw an error if the the function has not been deployed', () => {
      const kubelessLogs = new KubelessLogs(serverless, { function: 'test' });
      return expect(kubelessLogs.printLogs()).to.be.eventually.rejectedWith(
        'Unable to find the pod for the function test'
      );
    });
    it('should filter a specific number of log lines', () => {
      const kubelessLogs = new KubelessLogs(serverless, { count: 1, function: f });
      return expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[2]);
    });
    it('should filter a lines with a pattern', () => {
      const kubelessLogs = new KubelessLogs(serverless, { filter: 'POST', function: f });
      return expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[1]);
    });
    it('should filter a lines with a start time as a date string', () => {
      const kubelessLogs = new KubelessLogs(serverless, {
        // In the last two minutes
        startTime: moment().subtract('2', 'm').format(),
        function: f,
      });
      // Should return last entry
      return expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[2]);
    });
    it('should filter a lines with a start time as a number', () => {
      const kubelessLogs = new KubelessLogs(serverless, {
        // In the last two minutes
        startTime: moment().subtract('2', 'm').valueOf(),
        function: f,
      });
      // Should return last entry
      return expect(kubelessLogs.printLogs({ silent: true })).to.become(logsSample.split('\n')[2]);
    });
    it('should filter a lines from a period of time', () => {
      const kubelessLogs = new KubelessLogs(serverless, {
        // In the last two hours
        startTime: '2h',
        function: f,
      });
      // Should return last two entries
      return expect(kubelessLogs.printLogs({ silent: true })).to.become(
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
        const promise = kubelessLogs.printLogs({ silent: true });
        expect(console.log.callCount).to.be.eql(0);
        return expect(promise).to.become('');
      } finally {
        console.log.restore();
      }
    });
    it('calls Kubernetes API following the logs in case it is required', () => {
      sinon.stub(request, 'get').returns({
        on: () => {},
      });
      const kubelessLogs = new KubelessLogs(serverless, { function: f, tail: true });
      kubelessLogs.printLogs();
      expect(request.get.calledOnce).to.be.eql(true);
      expect(request.get.firstCall.args[0].url).to.be.eql(
        `${loadKubeConfig().clusters[0].cluster.server}` +
        `/api/v1/namespaces/default/pods/${pod}/log?follow=true`
      );
    });
  });
});
