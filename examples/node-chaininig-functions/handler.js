'use strict';

const _ = require('lodash');

function getBody(req, callback) {
  let body = [];
  req.on('data', (d) => body.push(d));
  req.on('end', () => {
    body = Buffer.concat(body).toString();
    callback(body);
  });
}
module.exports = {
  capitalize(req, res) {
    getBody(req, (body) => {
      res.end(_.capitalize(body));
    });
  },
  pad(req, res) {
    getBody(req, (body) => {
      res.end(_.pad(body, 20, '*'));
    });
  },
  reverse(req, res) {
    getBody(req, (body) => {
      res.end(body.split('').reverse().join(''));
    });
  },
};
