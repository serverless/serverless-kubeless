'use strict';

const _ = require('lodash');
const fs = require('fs');
const moment = require('moment');
const nock = require('nock');
const path = require('path');
const rm = require('./rm');
const sinon = require('sinon');
const yaml = require('js-yaml');

function thirdPartyResources(kubelessDeploy, namespace) {
  const put = sinon.stub().callsFake((body, callback) => {
    callback(null, { statusCode: 200 });
  });
  const result = {
    namespaces: {
      namespace: namespace || 'default',
    },
    ns: {
      functions: () => ({
        put,
      }),
    },
    addResource: sinon.stub(),
  };
  result.ns.functions.post = sinon.stub().callsFake((body, callback) => {
    callback(null, { statusCode: 200 });
  });
  result.ns.functions.get = sinon.stub().callsFake((callback) => {
    callback(null, { statusCode: 200, body: { items: [] } });
  });
  if (kubelessDeploy.getThirdPartyResources.isSinonProxy) {
    kubelessDeploy.getThirdPartyResources.returns(result);
  } else {
    sinon.stub(kubelessDeploy, 'getThirdPartyResources').returns(result);
  }
  return result;
}

function extensions(kubelessDeploy, namespace) {
  const result = {
    namespaces: {
      namespace: namespace || 'default',
    },
    ns: {
      ingress: {
        post: sinon.stub().callsFake((body, callback) => {
          callback(null, { statusCode: 200 });
        }),
      },
    },
    addResource: sinon.stub(),
  };
  sinon.stub(kubelessDeploy, 'getExtensions').returns(result);
  return result;
}

function kubeConfig(cwd) {
  fs.mkdirSync(path.join(cwd, '.kube'));
  fs.writeFileSync(
        path.join(cwd, '.kube/config'),
        'apiVersion: v1\n' +
        'current-context: cluster-id\n' +
        'clusters:\n' +
        '- cluster:\n' +
        '    certificate-authority-data: LS0tLS1\n' +
        '    server: http://1.2.3.4:4433\n' +
        '  name: cluster-name\n' +
        'contexts:\n' +
        '- context:\n' +
        '    cluster: cluster-name\n' +
        '    namespace: custom\n' +
        '    user: cluster-user\n' +
        '  name: cluster-id\n' +
        'users:\n' +
        '- name: cluster-user\n' +
        '  user:\n' +
        '    username: admin\n' +
        '    password: password1234\n'
    );
  process.env.HOME = cwd;
  return yaml.safeLoad(fs.readFileSync(path.join(cwd, '.kube/config')));
}

const previousEnv = _.cloneDeep(process.env);

function restoreKubeConfig(cwd) {
  rm(cwd);
  process.env = _.cloneDeep(previousEnv);
}


function createDeploymentNocks(endpoint, func, funcSpec, options) {
  const opts = _.defaults({}, options, {
    namespace: 'default',
    functionExists: false,
    description: null,
    labels: null,
    postReply: { message: 'OK' },
  });
  const postBody = {
    apiVersion: 'kubeless.io/v1beta1',
    kind: 'Function',
    metadata: {
      name: func,
      namespace: opts.namespace,
      labels: _.assign({
        'created-by': 'kubeless',
        function: func,
      }, opts.labels),
    },
    spec: funcSpec,
  };
  if (opts.description) {
    postBody.metadata.annotations = {
      'kubeless.serverless.com/description': opts.description,
    };
  }
  if (opts.labels) {
    postBody.spec.service.selector = _.assign(postBody.spec.service.selector, opts.labels);
  }
  nock(endpoint)
    .persist()
    .get('/api/v1/namespaces/kubeless/configmaps/kubeless-config')
    .reply(200, JSON.stringify({ data: { 'runtime-images': JSON.stringify([
      { ID: 'python', depName: 'requirements.txt' },
      { ID: 'nodejs', depName: 'package.json' },
      { ID: 'ruby', depName: 'Gemfile' },
    ]) } }));
  if (opts.functionExists) {
    nock(endpoint)
      .get(`/apis/kubeless.io/v1beta1/namespaces/${opts.namespace}/functions/${func}`)
      .reply(200, JSON.stringify(postBody));
  } else {
    nock(endpoint)
      .get(`/apis/kubeless.io/v1beta1/namespaces/${opts.namespace}/functions/${func}`)
      .reply(404, JSON.stringify({ code: 404 }));
  }
  nock(endpoint)
    .post(`/apis/kubeless.io/v1beta1/namespaces/${opts.namespace}/functions/`, postBody)
    .reply(200, opts.postReply);
  nock(endpoint)
    .persist()
    .get('/api/v1/pods')
    .reply(200, JSON.stringify({
      items: [{
        metadata: {
          name: func,
          labels: { function: func },
          creationTimestamp: moment().add('60', 's'),
        },
        spec: funcSpec,
        status: {
          containerStatuses: [{ ready: true, restartCount: 0 }],
        },
      }],
    }));
}

function createIngressNocks(endpoint, func, hostname, p, options) {
  const opts = _.defaults({}, options, {
    namespace: 'default',
  });
  nock(endpoint)
    .post(`/apis/extensions/v1beta1/namespaces/${opts.namespace}/ingresses`, {
      kind: 'Ingress',
      metadata: {
        annotations: {
          'kubernetes.io/ingress.class': 'nginx',
          'ingress.kubernetes.io/rewrite-target': '/',
        },
      },
      spec: {
        rules: [{
          host: hostname,
          http: {
            paths: [{ path: p, backend: { serviceName: func, servicePort: 8080 } }],
          },
        }],
      },
    })
    .reply(200, { message: 'OK' });
}

module.exports = {
  thirdPartyResources,
  extensions,
  kubeConfig,
  restoreKubeConfig,
  createDeploymentNocks,
  createIngressNocks,
};
