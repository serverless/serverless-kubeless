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

const BbPromise = require('bluebird');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const fs = require('fs');
const helpers = require('../lib/helpers');
const loadKubeConfig = require('./lib/load-kube-config');
const path = require('path');
const request = require('request');
const sinon = require('sinon');

const KubelessInvoke = require('../invoke/kubelessInvoke');
const serverless = require('./lib/serverless');

require('chai').use(chaiAsPromised);

describe('KubelessInvoke', () => {
  describe('#constructor', () => {
    const options = { test: 1 };
    const kubelessInvoke = new KubelessInvoke(serverless, options);
    it('should set the serverless instance', () => {
      expect(kubelessInvoke.serverless).to.be.eql(serverless);
    });
    it('should set options if provided', () => {
      expect(kubelessInvoke.options).to.be.eql(options);
    });
    it('should set a provider ', () => {
      expect(kubelessInvoke.provider).to.not.be.eql(undefined);
    });
    it('should have hooks', () => expect(kubelessInvoke.hooks).to.not.be.empty);
    it('should run promise chain in order', () => {
      const validateStub = sinon
      .stub(kubelessInvoke, 'validate').returns(BbPromise.resolve());
      const invokeStub = sinon
      .stub(kubelessInvoke, 'invokeFunction').returns(BbPromise.resolve());
      const logStub = sinon
      .stub(kubelessInvoke, 'log').returns(BbPromise.resolve());

      return kubelessInvoke.hooks['invoke:invoke']().then(() => {
        expect(validateStub.calledOnce).to.be.equal(true);
        expect(invokeStub.calledAfter(validateStub)).to.be.equal(true);
        expect(logStub.calledAfter(invokeStub)).to.be.equal(true);

        kubelessInvoke.validate.restore();
        kubelessInvoke.invokeFunction.restore();
        kubelessInvoke.log.restore();
      });
    });
  });
  describe('#validate', () => {
    it('throws an error if the given path with the data does not exists', () => {
      const kubelessInvoke = new KubelessInvoke(serverless, { path: '/not-exist' });
      expect(() => kubelessInvoke.validate()).to.throw(
        'The file you provided does not exist'
      );
    });
    it('throws an error if the given path with the data does not contain a valid JSON', () => {
      const filePath = path.join('/tmp/data.json');
      fs.writeFileSync(filePath, 'not-a-json');
      try {
        const kubelessInvoke = new KubelessInvoke(serverless, { path: '/tmp/data.json' });
        expect(() => kubelessInvoke.validate()).to.throw(
          'Unable to parse data given in the arguments: \n' +
          'Unexpected token o in JSON at position 1'
        );
      } finally {
        fs.unlinkSync('/tmp/data.json');
      }
    });
    it('prints a message if an unsupported option is given', () => {
      const kubelessInvoke = new KubelessInvoke(serverless, { region: 'us-east1' });
      sinon.stub(serverless.cli, 'log');
      try {
        expect(() => kubelessInvoke.validate()).to.not.throw();
        expect(serverless.cli.log.firstCall.args).to.be.eql(
          ['Warning: Option region is not supported for the kubeless plugin']
        );
      } finally {
        serverless.cli.log.restore();
      }
    });
  });
  describe('#invoke', () => {
    const kubeApiURL = 'http://1.2.3.4:4433';
    beforeEach(() => {
      sinon.stub(request, 'post');
      sinon.stub(request, 'get');
      sinon.stub(helpers, 'loadKubeConfig').callsFake(loadKubeConfig);
    });
    afterEach(() => {
      request.post.restore();
      request.get.restore();
      helpers.loadKubeConfig.restore();
    });
    it('calls the API end point with the correct arguments (without data)', () => {
      const kubelessInvoke = new KubelessInvoke(serverless, {
        function: 'my-function',
      });
      request.get.onFirstCall().callsFake((opts, f) => {
        f(null, {
          statusCode: 200,
          statusMessage: 'OK',
        });
      });
      expect(kubelessInvoke.invokeFunction()).to.become({
        statusCode: 200,
        statusMessage: 'OK',
      });
      expect(
        request.get.firstCall.args[0]
      ).to.contain.keys(['ca', 'auth', 'url']);
      expect(request.get.firstCall.args[0].url).to.be.eql(
        `${kubeApiURL}/api/v1/proxy/namespaces/default/services/my-function/`
      );
    });
    it('calls the API end point with the correct arguments (with raw data)', () => {
      const kubelessInvoke = new KubelessInvoke(serverless, {
        function: 'my-function',
        data: 'hello',
      });
      request.post.onFirstCall().callsFake((opts, f) => {
        f(null, {
          statusCode: 200,
          statusMessage: 'OK',
        });
      });
      expect(kubelessInvoke.invokeFunction()).to.become({
        statusCode: 200,
        statusMessage: 'OK',
      });
      expect(
        request.post.firstCall.args[0]
      ).to.contain.keys(['url', 'body']);
      expect(request.post.firstCall.args[0].url).to.be.eql(
        `${kubeApiURL}/api/v1/proxy/namespaces/default/services/my-function/`
      );
      expect(request.post.firstCall.args[0].body).to.be.eql('hello');
    });
    it('calls the API end point with the correct arguments (with JSON data)', () => {
      const kubelessInvoke = new KubelessInvoke(serverless, {
        function: 'my-function',
        data: '{"test": 1}',
      });
      request.post.onFirstCall().callsFake((opts, f) => {
        f(null, {
          statusCode: 200,
          statusMessage: 'OK',
        });
      });
      expect(kubelessInvoke.invokeFunction()).to.become({
        statusCode: 200,
        statusMessage: 'OK',
      });
      expect(
        request.post.firstCall.args[0]
      ).to.contain.keys(['url', 'json', 'body']);
      expect(request.post.firstCall.args[0].url).to.be.eql(
        `${kubeApiURL}/api/v1/proxy/namespaces/default/services/my-function/`
      );
      expect(request.post.firstCall.args[0].json).to.be.eql(true);
      expect(request.post.firstCall.args[0].body).to.be.eql({ test: 1 });
    });
    it('reject when an exit code different than 200 is returned', () => {
      const kubelessInvoke = new KubelessInvoke(serverless, {
        function: 'my-function',
      });
      request.post.onFirstCall().callsFake((opts, f) => {
        f(null, {
          statusCode: 500,
          statusMessage: 'Internal Error!',
        });
      });
      expect(kubelessInvoke.invokeFunction()).to.be.eventually.rejectedWith('Internal Error!');
    });
  });
  describe('#log', () => {
    it('should print the body of the response', () => {
      sinon.stub(console, 'log');
      try {
        const kubelessInvoke = new KubelessInvoke(serverless, { log: true });
        kubelessInvoke.log({ body: 'hello' });
        expect(console.log.calledTwice).to.be.eql(true);
        expect(console.log.firstCall.args).to.be.eql(
          ['--------------------------------------------------------------------']
        );
        expect(console.log.secondCall.args).to.be.eql(['hello']);
      } finally {
        console.log.restore();
      }
    });
  });
});
