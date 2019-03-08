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
const Config = require('../lib/config');
const helpers = require('../lib/helpers');
const sinon = require('sinon');

describe('Config', () => {
  describe('#constructor', () => {
    const previousEnv = _.cloneDeep(process.env);
    let urlStub;
    beforeEach(() => {
      urlStub = sinon
        .stub(helpers, 'getKubernetesAPIURL')
        .callsFake(() => 'API_URL');
    });
    afterEach(() => {
      urlStub.restore();
      process.env = _.cloneDeep(previousEnv);
    });
    it('should use a given namespace', () => {
      const config = new Config({ namespace: 'figjam' });
      expect(config.namespace).to.be.eql('figjam');
      expect(config.connectionOptions.url).to.be.eql(
        'API_URL/api/v1/namespaces/figjam/configmaps/kubeless-config'
      );
    });
    it('should use a given namespace even if env var is set', () => {
      process.env.KUBELESS_NAMESPACE = 'foobar';
      const config = new Config({ namespace: 'figjam' });
      expect(config.namespace).to.be.eql('figjam');
      expect(config.connectionOptions.url).to.be.eql(
        'API_URL/api/v1/namespaces/figjam/configmaps/kubeless-config'
      );
    });
    it('should use the namespace given via an env var if none is given in options', () => {
      process.env.KUBELESS_NAMESPACE = 'foobar';
      const config = new Config();
      expect(config.namespace).to.be.eql('foobar');
      expect(config.connectionOptions.url).to.be.eql(
        'API_URL/api/v1/namespaces/foobar/configmaps/kubeless-config'
      );
    });
  });
});
