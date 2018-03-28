'use strict';

const _ = require('lodash');

module.exports = {
  capitalize(event, context) {
    return _.capitalize(event.data);
  },
  pad(event, context) {
    return _.pad(event.data, 20, '*');
  },
  reverse(event, context) {
    return event.data.split('').reverse().join('');
  },
};
