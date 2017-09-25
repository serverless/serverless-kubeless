'use strict';

const _ = require('lodash');

module.exports = {
  printClock(req, res) {
    const now = new Date().toTimeString(
      { hour: '2-digit', minute: '2-digit' }
    ).slice(0, 5);
    console.log(now);
    res.end(now);
  },
};
