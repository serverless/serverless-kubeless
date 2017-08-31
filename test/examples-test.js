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
const exec = require('child_process').exec;
const expect = require('chai').expect;
const fs = require('fs-extra');
const helpers = require('../lib/helpers');
const moment = require('moment');
const path = require('path');
const request = require('request');

function deployExample(cwd, callback) {
  exec('serverless deploy', { cwd }, (deployErr, stdout) => {
    if (deployErr) {
      console.error(`ERROR: ${cwd} failed to be deployed:\n${stdout}\n${deployErr}`);
    }
    callback(deployErr);
  });
}
function prepareExample(cwd, example, callback) {
  fs.copy(`${__dirname}/../examples/${example}`, `${cwd}/${example}`, (err) => {
    if (err) throw err;
    fs.remove(`${cwd}/${example}/node_modules`, rmErr => {
      if (rmErr) throw rmErr;
      fs.mkdir(`${cwd}/${example}/node_modules`, mkdirErr => {
        if (mkdirErr) throw mkdirErr;
        fs.symlink(
          `${__dirname}/..`,
          `${cwd}/${example}/node_modules/serverless-kubeless`,
          (linkErr) => {
            if (linkErr) throw linkErr;
            deployExample(`${cwd}/${example}`, callback);
          }
        );
      });
    });
  });
}
function removeExample(cwd, callback) {
  exec('serverless remove', { cwd }, (removeErr) => {
    if (removeErr) throw removeErr;
    callback();
  });
}

function getURL(info, regexp) {
  let URL = info.match(regexp || /URL:\s+(.*)/)[1];
  if (URL.match('API_URL')) {
    URL = URL.replace(
      'API_URL',
      helpers.getKubernetesAPIURL(helpers.loadKubeConfig()).replace(/:[0-9]+$/, ''));
  }
  return URL;
}

function postWithRedirect(url, body, callback) {
  request.post({ url, body, strictSSL: false }, (err, res) => {
    if (res.statusCode === 301) {
      request.post({ url: res.headers.location, body, strictSSL: false }, (errR, resR) => {
        callback(errR, resR);
      });
    } else {
      callback(err, res);
    }
  });
}

describe('Examples', () => {
  let cwd = null;
  const examples = {
    'event-trigger-python': { cwd: null, path: 'event-trigger-python' },
    'get-python': { cwd: null, path: 'get-python' },
    'get-ruby': { cwd: null, path: 'get-ruby' },
    'http-custom-path': { cwd: null, path: 'http-custom-path' },
    'multi-python': { cwd: null, path: 'multi-python' },
    'node-chaining-functions': { cwd: null, path: 'node-chaining-functions' },
    'post-nodejs': { cwd: null, path: 'post-nodejs' },
    'post-python': { cwd: null, path: 'post-python' },
    'post-ruby': { cwd: null, path: 'post-ruby' },
    'todo-app': { cwd: null, path: 'todo-app/backend' },
  };
  before(function (done) {
    this.timeout(300000 * _.keys(examples).length);
    let count = 0;
    cwd = path.join('/tmp', moment().valueOf().toString());
    fs.mkdirSync(cwd);
    console.log('    Deploying examples');
    _.each(examples, example => {
      /* eslint no-param-reassign: ["error", { "props": false }]*/
      example.cwd = path.join(cwd, example.path);
      console.log(`\tDeploying ${example.path}`);
      prepareExample(cwd, example.path, (err) => {
        const increaseCont = () => {
          console.log(`\t${example.path} deployed`);
          count++;
          if (count === _.keys(examples).length) {
            done();
          }
        };
        if (err) {
          // Retry the deployment
          console.log(`\t${example.path} deployment failed, retrying...`);
          deployExample(example.cwd, increaseCont);
        } else {
          increaseCont();
        }
      });
    });
  });
  after(function (done) {
    this.timeout(10000 * _.keys(examples).length);
    let count = 0;
    _.each(examples, example => {
      removeExample(example.cwd, () => {
        count++;
        if (count === _.keys(examples).length) {
          fs.remove(cwd, (rmErr) => {
            if (rmErr) throw rmErr;
          });
          done();
        }
      });
    });
  });

  describe('event-trigger-python', function () {
    this.timeout(10000);
    it('should get a submmited message "hello world"', (done) => {
      exec('kubeless topic publish --topic hello_topic --data "hello world"', (err, stdout) => {
        if (err) {
          console.error(stdout);
          throw err;
        }
        exec(
          'serverless logs -f events',
          { cwd: examples['event-trigger-python'].cwd },
          (eerr, logs) => {
            if (eerr) throw eerr;
            expect(logs).to.contain('hello world');
            done();
          }
        );
      });
    });
  });
  describe('get-python', function () {
    this.timeout(10000);
    it('should return a "hello world"', (done) => {
      exec('serverless invoke -f hello -l', { cwd: examples['get-python'].cwd }, (err, stdout) => {
        if (err) throw err;
        expect(stdout).to.contain('hello world');
        done();
      });
    });
  });
  describe('get-ruby', function () {
    this.timeout(10000);
    it('should return the latest kubeless version', (done) => {
      exec('serverless invoke -f version -l', { cwd: examples['get-ruby'].cwd }, (err, stdout) => {
        if (err) throw err;
        expect(stdout).to.match(/[0-9]+\.[0-9]+\.[0-9]+/);
        done();
      });
    });
  });
  describe('http-custom-path', function () {
    this.timeout(10000);
    before((done) => {
      // We need some additional time for the ingress rule to work
      setTimeout(done, 9000);
    });
    it('should return a "hello world" in a subpath', (done) => {
      exec('serverless info', { cwd: examples['http-custom-path'].cwd }, (err, stdout) => {
        if (err) throw err;
        const URL = getURL(stdout);
        expect(URL).to.match(/.*\/hello/);
        request.get({ url: URL, strictSSL: false }, (gerr, res) => {
          if (gerr) throw gerr;
          expect(res.body).to.contain('hello world');
          done();
        });
      });
    });
  });
  describe('multi-python', function () {
    this.timeout(10000);
    it('should return "foo"', (done) => {
      exec(
        'serverless invoke -f foo -l --data \'{"hello": "world"}\'',
        { cwd: examples['multi-python'].cwd },
        (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('foo');
          done();
        }
      );
    });
    it('should return "bar"', (done) => {
      exec(
        'serverless invoke -f bar -l --data \'{"hello": "world"}\'',
        { cwd: examples['multi-python'].cwd },
        (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('bar');
          done();
        }
      );
    });
  });
  describe('post-nodejs', function () {
    this.timeout(10000);
    it('should return "Hello world"', (done) => {
      exec(
        'serverless invoke -f capitalize --data "hello world" -l',
        { cwd: examples['post-nodejs'].cwd },
        (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('Hello world');
          done();
        }
      );
    });
  });
  describe('post-python', function () {
    this.timeout(10000);
    it('should return a the request', (done) => {
      exec(
        'serverless invoke -f echo --data \'{"hello": "world"}\' -l',
        { cwd: examples['post-python'].cwd },
        (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('{ hello: \'world\' }');
          done();
        }
      );
    });
  });
  describe('post-ruby', function () {
    this.timeout(10000);
    it('should play ping-pong"', (done) => {
      exec(
        'serverless invoke -f ping --data "ping" -l',
        { cwd: examples['post-ruby'].cwd },
        (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('pong');
          done();
        }
      );
    });
  });
  describe('node-chaining-functions', function () {
    this.timeout(10000);
    it('should return an inversed, capizalized and padded word', (done) => {
      exec(
        'serverless invoke -f chained_seq -l --data \'hello world!\'',
        { cwd: examples['node-chaining-functions'].cwd },
        (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('****!dlrow olleH****');
          done();
        }
      );
    });
  });
  describe('todo-app', function () {
    this.timeout(10000);
    let info = '';
    let id = null;

    before(function (done) {
      this.timeout(300000);
      // We need to deploy a MongoDB for the todo-app example
      exec(
        'curl -sL https://raw.githubusercontent.com/bitnami/bitnami-docker-mongodb/3.4.7-r0/kubernetes.yml',
        (err, manifest) => {
          if (err) {
            console.error('ERROR: Unable to download mongodb manifest');
          } else {
            fs.writeFile(`${examples['todo-app'].cwd}/mongodb.yaml`, manifest, (werr) => {
              if (werr) throw werr;
              exec(`kubectl create -f ${examples['todo-app'].cwd}/mongodb.yaml`, (kerr) => {
                if (kerr) {
                  console.error(`ERROR: Unable to deploy the mongoDB manifest: ${kerr.message}`);
                }
                const wait = setInterval(() => {
                  exec('kubectl get pods', (gerr, stdout) => {
                    if (gerr) throw gerr;
                    if (stdout.match(/mongodb-.*Running/)) {
                      clearInterval(wait);
                      exec(
                        'serverless info',
                        { cwd: examples['todo-app'].cwd },
                        (infoerr, output) => {
                          if (infoerr) throw infoerr;
                          info = output;
                          // We need some additional time for the ingress rules to work
                          setTimeout(done, 15000);
                        }
                      );
                    }
                  });
                }, 2000);
              });
            });
          }
        }
      );
    });

    after(function (done) {
      this.timeout(300000);
      exec(`kubectl delete -f ${examples['todo-app'].cwd}/mongodb.yaml`, (kerr) => {
        if (kerr) {
          console.error(`ERROR: Unable to remove the mongoDB manifest: ${kerr.message}`);
        }
      });
      done();
    });
    it('should create a TODO', (done) => {
      const URL = getURL(info, /Service Information "create"\n(?:.*\n)*?URL:\s+(.*)/);
      expect(URL).to.match(/.*\/create/);
      postWithRedirect(URL, '{"body": "test"}', (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.contain.keys(['body', 'id', 'updatedAt']);
        expect(response.body).to.be.eql('test');
        id = response.id;
        done();
      });
    });
    it('should read all the TODOs', (done) => {
      const URL = getURL(info, /Service Information "read-all"\n(?:.*\n)*?URL:\s+(.*)/);
      expect(URL).to.match(/.*\/read-all/);
      request.get({ url: URL, strictSSL: false }, (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.be.an('array').with.length(1);
        expect(response[0]).to.contain.keys(['body', 'id', 'updatedAt']);
        expect(response[0].body).to.be.eql('test');
        done();
      });
    });
    it('should read one TODO', (done) => {
      const URL = getURL(info, /Service Information "read-one"\n(?:.*\n)*?URL:\s+(.*)/m);
      expect(URL).to.match(/.*\/read/);
      request.get({ url: `${URL}?id=${id}`, strictSSL: false }, (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.contain.keys(['body', 'id', 'updatedAt']);
        expect(response.body).to.be.eql('test');
        done();
      });
    });
    it('should update one TODO', (done) => {
      const URL = getURL(info, /Service Information "update"\n(?:.*\n)*?URL:\s+(.*)/m);
      expect(URL).to.match(/.*\/update/);
      postWithRedirect(`${URL}?id=${id}`, '{"body": "new-test"}', (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.contain.keys(['body', 'id', 'updatedAt']);
        expect(response.body).to.be.eql('new-test');
        id = response.id;
        done();
      });
    });
    it('should delete one TODO', (done) => {
      const URL = getURL(info, /Service Information "delete"\n(?:.*\n)*?URL:\s+(.*)/m);
      expect(URL).to.match(/.*\/delete/);
      request.get({ url: `${URL}?id=${id}`, strictSSL: false }, (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.contain.keys(['body', 'id', 'updatedAt']);
        expect(response.body).to.be.eql('new-test');
        done();
      });
    });
  });
});
