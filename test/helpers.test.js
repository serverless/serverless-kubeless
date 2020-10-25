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
const expect = require('chai').expect;
const fs = require('fs');
const helpers = require('../lib/helpers');
const loadKubeConfig = require('./lib/load-kube-config');
const moment = require('moment');
const os = require('os');
const path = require('path');
const rm = require('./lib/rm');
const yaml = require('js-yaml');

describe('Helper functions', () => {
  describe('#loadKubeConfig', () => {
    const configSample = loadKubeConfig();
    let cwd = null;
    const previousEnv = _.cloneDeep(process.env);
    beforeEach(() => {
      cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
    });
    afterEach(() => {
      process.env = _.cloneDeep(previousEnv);
      rm(cwd);
    });
    it('should find kubernetes config on its default path', () => {
      process.env.HOME = cwd;
      fs.mkdirSync(path.join(cwd, '.kube'));
      fs.writeFileSync(path.join(cwd, '.kube/config'), yaml.safeDump(configSample));
      expect(helpers.loadKubeConfig()).to.be.eql(configSample);
    });
    it('should find kubernetes config specified at KUBECONFIG', () => {
      process.env.KUBECONFIG = path.join(cwd, 'config');
      fs.writeFileSync(path.join(cwd, 'config'), yaml.safeDump(configSample));
      expect(helpers.loadKubeConfig()).to.be.eql(configSample);
    });
    it('should merge kubernetes config specified at KUBECONFIG', () => {
      process.env.KUBECONFIG = `${path.join(cwd, 'config-1')}:${path.join(cwd, 'config-2')}`;
      fs.writeFileSync(
        path.join(cwd, 'config-1'),
        yaml.safeDump(
          _.assign({}, configSample, { 'current-context': 'cluster-id-1' })
        )
      );
      fs.writeFileSync(
        path.join(cwd, 'config-2'),
        yaml.safeDump(
          _.assign({}, configSample, { test: 'test-value' })
        )
      );
      expect(helpers.loadKubeConfig()).to.be.eql(_.defaults(
        { 'current-context': 'cluster-id-1' },
        { test: 'test-value' },
        configSample
      ));
    });
  });
  describe('#getKubernetesAPIURL', () => {
    it('retrieves the server URL', () => {
      const config = loadKubeConfig();
      const expectedURL = config.clusters[0].cluster.server;
      expect(helpers.getKubernetesAPIURL(config)).to.be.eql(expectedURL);
    });
    it('retrieves the server URL without the trailing /', () => {
      const config = loadKubeConfig({
        clusters: [
          {
            cluster: {
              'certificate-authority-data': 'LS0tLS1',
              server: 'http://1.2.3.4:4433/',
            },
            name: 'cluster-name',
          },
        ],
      });
      expect(helpers.getKubernetesAPIURL(config)).to.be.eql('http://1.2.3.4:4433');
    });
  });
  describe('#getConnectionOptions', () => {
    it('should return the correct options based on the current context', () => {
      const config = {
        'current-context': 'cluster-id-2',
        clusters: [{
          cluster: { 'certificate-authority-data': 'LS0tLS1', server: 'http://1.2.3.4:4433' },
          name: 'cluster-name-1',
        }, {
          cluster: { 'certificate-authority-data': 'LS0tLS1', server: 'http://4.3.2.1:4433' },
          name: 'cluster-name-2',
        }],
        contexts: [{
          context: { cluster: 'cluster-name-1', user: 'cluster-user-1' },
          name: 'cluster-id-1',
        }, {
          context: { cluster: 'cluster-name-2', user: 'cluster-user-2' },
          name: 'cluster-id-2',
        }],
        users: [
          { name: 'cluster-user-1', user: { username: 'admin-1', password: 'password1234' } },
          { name: 'cluster-user-2', user: { username: 'admin-2', password: 'password4321' } },
        ],
      };
      expect(helpers.getConnectionOptions(config)).to.be.eql({
        group: 'k8s.io',
        namespace: 'default',
        url: 'http://4.3.2.1:4433',
        ca: Buffer.from('LS0tLS1', 'base64'),
        auth: {
          user: 'admin-2',
          password: 'password4321',
        },
      });
    });
    it('should return the correct namespace based on the current context', () => {
      const config = loadKubeConfig({
        'current-context': 'cluster-id',
        contexts: [{
          context: { cluster: 'cluster-name', user: 'cluster-user', namespace: 'custom' },
          name: 'cluster-id',
        }],
      });
      expect(helpers.getConnectionOptions(config).namespace).to.be.eql('custom');
    });
    it('should return connection options with a certificate-authority (file)', () => {
      const ca = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.writeFileSync(ca, 'abcdef1234');
      const config = loadKubeConfig({
        clusters: [
          {
            cluster: {
              'certificate-authority': ca,
              server: 'http://1.2.3.4:4433',
            },
            name: 'cluster-name',
          },
        ],
      });
      try {
        expect(helpers.getConnectionOptions(config).ca.toString()).to.be.eql('abcdef1234');
      } finally {
        rm(ca);
      }
    });
    it('should return connection options with a certificate-authority (data)', () => {
      const config = loadKubeConfig({
        clusters: [
          {
            cluster: {
              'certificate-authority-data': 'LS0tLS1',
              server: 'http://1.2.3.4:4433',
            },
            name: 'cluster-name',
          },
        ],
      });
      expect(helpers.getConnectionOptions(config).ca).to.be.eql(Buffer.from('LS0tLS1', 'base64'));
    });
    it('should return connection options with a token', () => {
      const config = loadKubeConfig({
        users: [
          {
            name: 'cluster-user',
            user: {
              token: 'token1234',
            },
          },
        ],
      });
      expect(helpers.getConnectionOptions(config).auth).to.be.eql({
        bearer: 'token1234',
      });
    });
    it('should return connection options with an id token', () => {
      const config = loadKubeConfig({
        users: [
          {
            name: 'cluster-user',
            user: {
              'auth-provider': {
                config: {
                  'id-token': 'token1234',
                },
              },
            },
          },
        ],
      });
      expect(helpers.getConnectionOptions(config).auth).to.be.eql({
        bearer: 'token1234',
      });
    });
    it('should return connection options with an access token', () => {
      const config = loadKubeConfig({
        users: [
          {
            name: 'cluster-user',
            user: {
              'auth-provider': {
                config: {
                  'access-token': 'token1234',
                  expiry: moment().add('1', 'm'),
                },
              },
            },
          },
        ],
      });
      expect(helpers.getConnectionOptions(config).auth).to.be.eql({
        bearer: 'token1234',
      });
    });
    it('should throw an error if the access-token has expired', () => {
      const config = loadKubeConfig({
        users: [
          {
            name: 'cluster-user',
            user: {
              'auth-provider': {
                config: {
                  'access-token': 'token1234',
                  expiry: moment().subtract('1', 'm'),
                },
              },
            },
          },
        ],
      });
      expect(() => helpers.getConnectionOptions(config)).to.throw('The access token has expired');
    });
    it('should return connection options with user and password', () => {
      const config = loadKubeConfig({
        users: [
          {
            name: 'cluster-user',
            user: {
              username: 'cluster-admin',
              password: 'admin-password',
            },
          },
        ],
      });
      expect(helpers.getConnectionOptions(config).auth).to.be.eql({
        user: 'cluster-admin',
        password: 'admin-password',
      });
    });
    it('should return connection options with cert and key (files)', () => {
      const cwd = path.join(os.tmpdir(), moment().valueOf().toString());
      fs.mkdirSync(cwd);
      fs.writeFileSync(path.join(cwd, 'server.key'), 'abcdef1234');
      fs.writeFileSync(path.join(cwd, 'cert.crt'), 'cert1234');
      const config = loadKubeConfig({
        users: [
          {
            name: 'cluster-user',
            user: {
              'client-certificate': path.join(cwd, 'cert.crt'),
              'client-key': path.join(cwd, 'server.key'),
            },
          },
        ],
      });
      const result = helpers.getConnectionOptions(config);
      try {
        expect(result.cert.toString()).to.be.eql('cert1234');
        expect(result.key.toString()).to.be.eql('abcdef1234');
      } finally {
        rm(cwd);
      }
    });
    it('should return connection options with cert and key (data)', () => {
      const config = loadKubeConfig({
        users: [
          {
            name: 'cluster-user',
            user: {
              'client-certificate-data': Buffer.from('cert1234').toString('base64'),
              'client-key-data': Buffer.from('abcdef1234').toString('base64'),
            },
          },
        ],
      });
      const result = helpers.getConnectionOptions(config);
      expect(result.cert.toString()).to.be.eql('cert1234');
      expect(result.key.toString()).to.be.eql('abcdef1234');
    });
  });
});
