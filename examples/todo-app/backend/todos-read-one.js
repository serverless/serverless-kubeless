'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');

const MongoClient = mongodb.MongoClient;
const url = 'mongodb://mongodb:27017/todo_app';

module.exports = {
  readOne: (event, context) => new Promise((resolve, reject) => {
    MongoClient.connect(url, (err, db) => {
      if (err) {
        reject(err);
      } else {
        db.collection('todos').find().toArray((ferr, docEntries) => {
          if (ferr) {
            reject(ferr);
          } else {
            const entry = _.find(docEntries, e => e.id === event.extensions.request.query.id);
            db.close();
            resolve(JSON.stringify(entry));
          }
        });
      }
    });
  }),
};
