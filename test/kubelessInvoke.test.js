'use strict';

const _ = require('lodash');
const BbPromise = require('bluebird');
const chaiAsPromised = require('chai-as-promised');
const expect = require('chai').expect;
const fs = require('fs');
const path = require('path');
const request = require('request');
const sinon = require('sinon');

const KubelessInvoke = require('../invoke/kubelessInvoke');
const serverless = require('./lib/serverless');

require('chai').use(chaiAsPromised);

describe('KubelessInvoke', () => {
  const previousEnv = _.clone(process.env);
  const kubeApiURL = 'http://1.2.3.4:4433';
  beforeEach(() => {
    process.env.KUBE_API_URL = kubeApiURL;
  });
  afterEach(() => {
    process.env = previousEnv;
  });
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
    it('should have hooks', () => expect(kubelessInvoke.hooks).to.be.not.empty);
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
    it('throws an error if the variable KUBE_API_URL is not set', () => {
      const kubelessInvoke = new KubelessInvoke(serverless);
      delete process.env.KUBE_API_URL;
      expect(() => kubelessInvoke.validate()).to.throw(
        'Please specify the Kubernetes API server IP as the environment variable KUBE_API_URL'
      );
    });
    it('throws an error if the given data is not a valid JSON object', () => {
      const kubelessInvoke = new KubelessInvoke(serverless, { data: 'not-a-json' });
      expect(() => kubelessInvoke.validate()).to.throw(
        'Unable to parse data given in the arguments: \n' +
        'Unexpected token o in JSON at position 1'
      );
    });
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
    beforeEach(() => {
      sinon.stub(request, 'post');
    });
    afterEach(() => {
      request.post.restore();
    });
    it('calls the API end point with the correct arguments', () => {
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
      ).to.have.keys(['cert', 'ca', 'key', 'url', 'json', 'body']);
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
