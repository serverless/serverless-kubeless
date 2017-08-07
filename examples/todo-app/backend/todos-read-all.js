'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');

const MongoClient = mongodb.MongoClient;
const url = 'mongodb://mongodb:27017/todo_app';

module.exports = {
  readAll: (req, res) => new Promise((resolve, reject) => {
    res.header('Access-Control-Allow-Origin', '*');
    MongoClient.connect(url, (err, db) => {
      if (err) {
        reject(err);
      } else {
        db.collection('todos', (errC, doc) => {
          if (errC) {
            reject(errC);
          } else {
            doc.find().toArray((ferr, docEntries) => {
              if (ferr) {
                reject(ferr);
              } else {
                const entries = _.map(docEntries, e => e.Item);
                res.end(JSON.stringify(entries));
                db.close();
                resolve();
              }
            });
          }
        });
      }
    });
  }),
};
