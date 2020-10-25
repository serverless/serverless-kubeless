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
const crypto = require('crypto');

function prepareExample(cwd, example, callback) {
  fs.copy(`${__dirname}/../examples/${example}`, `${cwd}/${example}`, (err) => {
    if (err) callback(err);
    fs.remove(`${cwd}/${example}/node_modules`, rmErr => {
      if (rmErr) callback(rmErr);
      callback();
    });
  });
}
function deployExample(cwd, callback, retries = 0) {
  if (retries < 3) {
    exec('serverless deploy', { cwd }, (deployErr, stdout) => {
      if (deployErr) {
        console.error(`ERROR: ${cwd} failed to be deployed:\n${stdout}\n${deployErr}`);
        const newRetries = retries + 1;
        deployExample(cwd, callback, newRetries);
      }
      callback();
    });
  } else {
    callback(new Error('Failed to deploy after 3 retries'));
  }
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
  URL = _.startsWith(URL, 'http://') ? URL : `http://${URL}`;
  return URL;
}

function waitForURL(url, callback, retries = 0) {
  if (retries < 10) {
    request.get(url, (gerr, res) => {
      if (gerr || res.body.match('404')) {
        console.error('Retrying: ', gerr || res.body);
        const newRetries = retries + 1;
        setTimeout(() => waitForURL(url, callback, newRetries), 5000);
      } else {
        callback(res);
      }
    });
  }
}

function postWithRedirect(req, callback) {
  request.post(req, (err, res) => {
    if (err) throw err;
    if (res.statusCode === 301) {
      request.post(_.assign(req, { url: res.headers.location }), (errR, resR) => {
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
    'http-custom-path': { cwd: null, path: 'http-custom-path' },
    'multi-python': { cwd: null, path: 'multi-python' },
    'node-chaining-functions': { cwd: null, path: 'node-chaining-functions' },
    'post-nodejs': { cwd: null, path: 'post-nodejs' },
    'post-python': { cwd: null, path: 'post-python' },
    'post-php': { cwd: null, path: 'post-php' },
    'post-php-s3': { cwd: null, path: 'post-php-s3' },
    'post-go': { cwd: null, path: 'post-go' },
    'post-ruby': { cwd: null, path: 'post-ruby' },
    'scheduled-node': { cwd: null, path: 'scheduled-node' },
    'todo-app': { cwd: null, path: 'todo-app/backend' },
  };
  before(function (done) {
    this.timeout(300000 * _.keys(examples).length);
    cwd = path.join('/tmp', moment().valueOf().toString());
    fs.mkdirSync(cwd);
    fs.mkdir(`${cwd}/node_modules`, mkdirErr => {
      if (mkdirErr) throw mkdirErr;
      fs.symlink(
        `${__dirname}/..`,
        `${cwd}/node_modules/serverless-kubeless`,
        (linkErr) => {
          if (linkErr) throw linkErr;
          done();
        });
    });
  });
  after(function (done) {
    this.timeout(10000);
    fs.remove(cwd, (rmErr) => {
      if (rmErr) throw rmErr;
      done();
    });
  });

  describe('get-python', function () {
    const exampleName = 'get-python';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
    this.timeout(10000);
    it('should return a "hello world"', (done) => {
      exec('serverless invoke -f hello -l', { cwd: examples['get-python'].cwd }, (err, stdout) => {
        if (err) throw err;
        expect(stdout).to.contain('hello world');
        done();
      });
    });
  });
  describe('http-custom-path', function () {
    this.timeout(30000);
    const exampleName = 'http-custom-path';
    before(function (done) {
      this.timeout(300000);
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after((done) => {
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
    it('should return a "hello world" in a subpath', (done) => {
      exec('serverless info', { cwd: examples['http-custom-path'].cwd }, (err, stdout) => {
        if (err) throw err;
        const URL = getURL(stdout);
        waitForURL(URL, (res) => {
          expect(res.body).to.contain('hello world');
          done();
        });
      });
    });
  });
  describe('multi-python', function () {
    const exampleName = 'multi-python';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
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
    const exampleName = 'post-nodejs';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
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
    const exampleName = 'post-python';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
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
    const exampleName = 'post-ruby';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
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
  describe('post-php', function () {
    const exampleName = 'post-php';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(100000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
    this.timeout(10000);
    it('should return a "hello"', (done) => {
      exec('serverless invoke -f php-echo -l --data \'hello!\'',
        { cwd: examples['post-php'].cwd }, (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('hello!');
          done();
        });
    });
  });
  describe('post-php-s3', function () {
    const exampleName = 'post-php-s3';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        // 4Mb of junk to be sure .zip size will exceed etcd limit
        fs.writeFileSync(
            path.join(examples[exampleName].cwd, 'payload.bin'),
            crypto.pseudoRandomBytes(4 * 1024 * 1024)
        );
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(100000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
    this.timeout(300000);
    it('should return a "hello"', (done) => {
      exec('serverless invoke -f php-echo-s3 -l --data \'hello!\'',
        { cwd: examples['post-php-s3'].cwd }, (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('hello!');
          done();
        });
    });
  });
  describe('post-go', function () {
    const exampleName = 'post-go';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(100000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
    this.timeout(10000);
    it('should return a "hello"', (done) => {
      exec('serverless invoke -f go-echo -l --data \'hello!\'',
        { cwd: examples['post-go'].cwd }, (err, stdout) => {
          if (err) throw err;
          expect(stdout).to.contain('hello!');
          done();
        });
    });
  });
  describe('scheduled-node', function () {
    const exampleName = 'scheduled-node';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
    this.timeout(60000);
    it('should print the time in the logs', (done) => {
      const int = setInterval(() => {
        exec(
          'serverless logs -f clock',
          { cwd: examples['scheduled-node'].cwd },
          (err, stdout) => {
            if (err) throw err;
            if (stdout.match(/^\d{2}:\d{2}$/m)) {
              clearInterval(int);
              done();
            }
          }
        );
      }, 5000);
    });
  });
  describe('node-chaining-functions', function () {
    const exampleName = 'node-chaining-functions';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
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
  xdescribe('todo-app', function () {
    this.timeout(10000);
    let info = '';
    let id = null;
    const exampleName = 'todo-app';
    before(function (done) {
      this.timeout(600000);
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      // We need to deploy a MongoDB for the todo-app example
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        exec(
          'curl -sL https://raw.githubusercontent.com/bitnami/bitnami-docker-mongodb/3.4.7-r0/kubernetes.yml',
          (err, manifest) => {
            if (err) {
              throw new Error(`ERROR: Unable to download mongodb manifest: ${err.message}`);
            } else {
              fs.writeFile(`${examples['todo-app'].cwd}/mongodb.yaml`, manifest, (werr) => {
                if (werr) throw werr;
                exec(`kubectl create -f ${examples['todo-app'].cwd}/mongodb.yaml`, (kerr) => {
                  if (kerr) {
                    console.error(`ERROR: Unable to deploy the mongoDB manifest: ${kerr.message}`);
                  }
                  deployExample(examples[exampleName].cwd, (ee) => {
                    if (ee) {
                      throw ee;
                    }
                    let calledDone = false;
                    const wait = setInterval(() => {
                      exec('kubectl get pods', (gerr, stdout) => {
                        if (gerr) throw gerr;
                        if (stdout.match(/mongodb-.*Running/)) {
                          exec('kubectl logs -l io.kompose.service=mongodb', (lerr, logs) => {
                            if (lerr) throw lerr;
                            if (logs.match(/Starting mongod/)) {
                              clearInterval(wait);
                              exec(
                                'serverless info',
                                { cwd: examples['todo-app'].cwd },
                                (infoerr, output) => {
                                  if (infoerr) throw infoerr;
                                  info = output;
                                  // We need some additional time for the ingress rules to work
                                  if (!calledDone) {
                                    setTimeout(done, 15000);
                                    calledDone = true;
                                  }
                                }
                              );
                            }
                          });
                        }
                      });
                    }, 2000);
                  });
                });
              });
            }
          }
        );
      });
    });

    after(function (done) {
      this.timeout(300000);
      exec(`kubectl delete -f ${examples['todo-app'].cwd}/mongodb.yaml`, (kerr) => {
        if (kerr) {
          console.error(`ERROR: Unable to remove the mongoDB manifest: ${kerr.message}`);
        }
        removeExample(examples[exampleName].cwd, () => {
          done();
        });
      });
    });
    it('should create a TODO', (done) => {
      const URL = getURL(info, /Service Information "create"\n(?:.*\n)*?URL:\s+(.*)/);
      expect(URL).to.match(/.*\/create/);
      postWithRedirect({ url: URL, json: true, body: { body: 'test' } }, (err, res) => {
        if (err) throw err;
        const response = res.body;
        expect(response).to.contain.keys(['_id', 'id', 'updatedAt']);
        id = response.id;
        done();
      });
    });
    it('should read all the TODOs', (done) => {
      const URL = getURL(info, /Service Information "read-all"\n(?:.*\n)*?URL:\s+(.*)/);
      expect(URL).to.match(/.*\/read-all/);
      request.get({ url: URL }, (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.be.an('array').with.length(1);
        expect(response[0]).to.contain.keys(['_id', 'id', 'updatedAt']);
        done();
      });
    });
    it('should read one TODO', (done) => {
      const URL = getURL(info, /Service Information "read-one"\n(?:.*\n)*?URL:\s+(.*)/m);
      expect(URL).to.match(/.*\/read/);
      request.get({ url: `${URL}?id=${id}` }, (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.contain.keys(['_id', 'id', 'updatedAt']);
        done();
      });
    });
    it('should update one TODO', (done) => {
      const URL = getURL(info, /Service Information "update"\n(?:.*\n)*?URL:\s+(.*)/m);
      expect(URL).to.match(/.*\/update/);
      postWithRedirect({
        url: `${URL}?id=${id}`,
        json: true,
        body: { body: 'new-test' },
      }, (err, res) => {
        if (err) throw err;
        const response = res.body;
        expect(response).to.contain.keys(['_id', 'id', 'updatedAt']);
        id = response.id;
        done();
      });
    });
    it('should delete one TODO', (done) => {
      const URL = getURL(info, /Service Information "delete"\n(?:.*\n)*?URL:\s+(.*)/m);
      expect(URL).to.match(/.*\/delete/);
      request.get({ url: `${URL}?id=${id}` }, (err, res) => {
        if (err) throw err;
        const response = JSON.parse(res.body);
        expect(response).to.contain.keys(['_id', 'id', 'updatedAt']);
        done();
      });
    });
  });
  xdescribe('event-trigger-python', function () {
    const exampleName = 'event-trigger-python';
    before(function (done) {
      examples[exampleName].cwd = path.join(cwd, examples[exampleName].path);
      this.timeout(300000);
      prepareExample(cwd, exampleName, (e) => {
        if (e) {
          throw e;
        }
        deployExample(examples[exampleName].cwd, (ee) => {
          if (ee) {
            throw ee;
          }
          done();
        });
      });
    });
    after(function (done) {
      this.timeout(10000);
      removeExample(examples[exampleName].cwd, () => {
        done();
      });
    });
    this.timeout(30000);
    it('should get a submmited message "hello world"', (done) => {
      exec(
        'kubeless topic publish --topic hello_topic --data "hello world"',
        (err, stdout) => {
          if (err) {
            throw new Error(stdout);
          }
          let calledDone = false;
          const t = setInterval(() => {
            exec(
              'serverless logs -f events',
              { cwd: examples['event-trigger-python'].cwd },
              (eerr, logs) => {
                if (eerr) throw (eerr);
                try {
                  expect(logs).to.contain('hello world');
                  clearInterval(t);
                  if (!calledDone) {
                    calledDone = true;
                    done();
                  }
                } catch (e) {
                  // Retry
                }
              }
            );
          }, 2000);
          setTimeout(() => {
            clearInterval(t);
            throw new Error('Failed to obtain the expected logs');
          }, 30000);
        });
    });
  });
});
