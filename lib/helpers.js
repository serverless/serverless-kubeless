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
const fs = require('fs');
const moment = require('moment');
const path = require('path');
const yaml = require('js-yaml');
const proc = require('child_process');

function loadKubeConfig() {
  const kubeCfgPath = path.join(process.env.HOME, '.kube/config');
  let config = {};
  if (process.env.KUBECONFIG) {
    // KUBECONFIG paths list is semicolon delimited for Windows
    // and colon delimited for Mac and Linux
    let kubeConfigDelimiter;
    if (process.platform === 'win32') {
      kubeConfigDelimiter = ';';
    } else {
      kubeConfigDelimiter = ':';
    }
    const configFiles = process.env.KUBECONFIG.split(kubeConfigDelimiter);
    _.each(configFiles, configFile => {
      _.defaults(config, yaml.safeLoad(fs.readFileSync(configFile)));
    });
  } else if (!fs.existsSync(kubeCfgPath)) {
    throw new Error(
      'Unable to locate the configuration file for your cluster. ' +
      'Make sure you have your cluster configured locally'
    );
  } else {
    config = yaml.safeLoad(fs.readFileSync(kubeCfgPath));
  }
  return config;
}

function getContextName(config) {
  return process.env.KUBECONTEXT || config['current-context'];
}

function getContextInfo(config, context) {
  const contextInfo = _.find(config.contexts, c => c.name === context);
  if (!contextInfo) {
    throw new Error(`Unable to find configuration of context ${context}`);
  }
  return contextInfo.context;
}

function getClusterInfo(config, context) {
  const clusterName = getContextInfo(config, context).cluster;
  const clusterInfo = _.find(config.clusters, c => c.name === clusterName);
  if (!clusterInfo) {
    throw new Error(`Unable to find cluster information for context ${context}`);
  }
  return clusterInfo;
}

function getUserInfo(config, context) {
  const userName = getContextInfo(config, context).user;
  const userInfo = _.find(config.users, u => u.name === userName);
  if (!userInfo) {
    throw new Error(`Unable to find user information for context ${context}`);
  }
  return userInfo;
}

function getKubernetesAPIURL(config) {
  const currentContext = getContextName(config);
  const clusterInfo = getClusterInfo(config, currentContext);
  // Remove trailing '/' of the URL in case it exists
  let clusterURL = clusterInfo.cluster.server.replace(/\/$/, '');
  // Add protocol if missing
  clusterURL = _.startsWith(clusterURL, 'http') ? clusterURL : `http://${clusterURL}`;
  return clusterURL;
}

function getPropertyText(property, info) {
  // Data could be pointing to a file or be base64 encoded
  let result = null;
  if (!_.isEmpty(info[property])) {
    result = fs.readFileSync(info[property]);
  } else if (!_.isEmpty(info[`${property}-data`])) {
    result = Buffer.from(info[`${property}-data`], 'base64');
  }
  return result;
}

function getToken(userInfo) {
  const token = _.get(userInfo, 'user.token') ||
    _.get(userInfo, 'user.auth-provider.config.id-token');
  const accessToken = _.get(userInfo, 'user.auth-provider.config.access-token');
  let cmd = _.get(userInfo, 'user.exec.command');
  const awsClis = ['aws', 'aws-iam-authenticator'];
  if (token) {
    return token;
  } else if (accessToken) {
    // Access tokens may expire so we better check the expire date
    if (userInfo.user['auth-provider'].config.expiry) {
      const expiry = moment(userInfo.user['auth-provider'].config.expiry);
      if (expiry < moment()) {
        throw new Error(
          'The access token has expired. Make sure you can access your cluster and try again'
        );
      }
    }
    return accessToken;
  } else if (cmd && awsClis.includes(cmd) !== -1) {
    const args = _.get(userInfo, 'user.exec.args');
    if (args) {
      cmd = `${cmd} ${args.join(' ')}`;
    }
    const env = _.get(userInfo, 'user.exec.env', []);
    const envvars = Object.assign({}, process.env);
    if (env) {
      const profile = _.find(env, e => e.name === 'AWS_PROFILE');
      if (profile) {
        envvars['AWS_PROFILE'] = profile.value;
      }
    }
    let output = {};
    try {
      output = proc.execSync(cmd, envvars);
    } catch (err) {
      throw new Error(`Failed to refresh token: ${err.message}`);
    }
    const resultObj = JSON.parse(output);
    const execToken = _.get(resultObj, 'status.token');
    if (execToken) {
      return execToken;
    }
  }
  return null;
}

function getDefaultNamespace(config) {
  const currentContext = getContextName(config);
  return getContextInfo(config, currentContext).namespace || 'default';
}

function getConnectionOptions(config, modif) {
  const currentContext = getContextName(config);
  const userInfo = getUserInfo(config, currentContext);
  const clusterInfo = getClusterInfo(config, currentContext);

  const connectionOptions = {
    group: 'k8s.io',
    url: getKubernetesAPIURL(config),
    namespace: getDefaultNamespace(config),
  };
  // Config certificate-authority
  const ca = getPropertyText('certificate-authority', clusterInfo.cluster);
  if (ca) {
    connectionOptions.ca = ca;
  } else {
    // No certificate-authority found
    connectionOptions.insecureSkipTlsVerify = true;
    connectionOptions.strictSSL = false;
  }
  // Config authentication
  const token = getToken(userInfo);
  if (token) {
    connectionOptions.auth = {
      bearer: token,
    };
  } else {
    // If there is not a valid token we can authenticate either using
    // username and password or a certificate and a key
    const user = _.get(userInfo, 'user.username');
    const password = _.get(userInfo, 'user.password');
    if (!_.isEmpty(user) && !_.isEmpty(password)) {
      connectionOptions.auth = { user, password };
    } else {
      const properties = {
        cert: 'client-certificate',
        key: 'client-key',
      };
      _.each(properties, (property, key) => {
        connectionOptions[key] = getPropertyText(property, userInfo.user);
        if (!connectionOptions[key]) {
          console.log(
            'Unable to find required information for authenticating against the cluster'
          );
        }
      });
    }
  }
  return _.defaults({}, modif, connectionOptions);
}

function warnUnsupportedOptions(unsupportedOptions, definedOptions, logFunction) {
  unsupportedOptions.forEach((opt) => {
    if (!_.isUndefined(definedOptions[opt])) {
      logFunction(`Warning: Option ${opt} is not supported for the kubeless plugin`);
    }
  });
}

function getRuntimeDepfile(runtime, configMap) {
  const runtimesInfo = configMap.get('runtime-images', { parse: true });
  let depFile = null;
  _.each(runtimesInfo, r => {
    if (runtime.match(r.ID)) {
      depFile = r.depName;
    }
  });
  if (!depFile) {
    throw new Error(
      `The runtime ${runtime} is not supported yet`
    );
  }
  return depFile;
}

function checkFinished(counter, max, errors, resolve, reject, options) {
  const opts = _.defaults({}, options, {
    onSuccess: () => new Promise(r => r()),
  });
  if (counter === max) {
    if (_.isEmpty(errors)) {
      opts.onSuccess().then(resolve);
    } else {
      reject(new Error(
        'Found errors while processing the given functions:\n' +
        `${errors.join('\n')}`
      ));
    }
  }
}

function getDeployableItemsNumber(functions) {
  return _.sum([_.keys(functions).length].concat(_.map(functions, f => _.size(f.events))));
}

module.exports = {
  warnUnsupportedOptions,
  loadKubeConfig,
  getKubernetesAPIURL,
  getDefaultNamespace,
  getConnectionOptions,
  getRuntimeDepfile,
  checkFinished,
  getDeployableItemsNumber,
};
