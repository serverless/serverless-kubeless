'use strict';

/*
NOTE: this plugin is used to add all the differnet provider related plugins at once.
This way only one plugin needs to be added to the service in order to get access to the
whole provider implementation.
*/

const KubelessProvider = require('./provider/kubelessProvider');
const KubelessDeploy = require('./deploy/kubelessDeploy');
const KubelessRemove = require('./remove/kubelessRemove');
const KubelessInvoke = require('./invoke/kubelessInvoke');
const KubelessInfo = require('./info/kubelessInfo');
const KubelessLogs = require('./logs/kubelessLogs');

class KubelessIndex {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;

    this.serverless.pluginManager.addPlugin(KubelessProvider);
    this.serverless.pluginManager.addPlugin(KubelessDeploy);
    this.serverless.pluginManager.addPlugin(KubelessRemove);
    this.serverless.pluginManager.addPlugin(KubelessInvoke);
    this.serverless.pluginManager.addPlugin(KubelessInfo);
    this.serverless.pluginManager.addPlugin(KubelessLogs);
  }
}

module.exports = KubelessIndex;
