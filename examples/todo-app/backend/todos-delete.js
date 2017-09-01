'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');

const MongoClient = mongodb.MongoClient;
const url = 'mongodb://mongodb:27017/todo_app';

module.exports = {
  delete: (req, res) => new Promise((resolve, reject) => {
    MongoClient.connect(url, (err, db) => {
      if (err) {
        reject(err);
      } else {
        db.collection('todos', (errC, doc) => {
          if (errC) {
            reject(ferr);
          } else {
            doc.find().toArray((ferr, docEntries) => {
              if (ferr) {
                reject(ferr);
              } else {
                const entry = _.find(docEntries, e => e.id === req.query.id);
                doc.deleteOne(entry, (derr) => {
                  if (derr) {
                    reject(derr);
                  } else {
                    res.end(JSON.stringify(entry));
                    resolve();
                    db.close();
                  }
                });
              }
            });
          }
        });
      }
    });
  }),
};
