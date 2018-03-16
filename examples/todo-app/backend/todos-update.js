'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');
const uuid = require('uuid');

const MongoClient = mongodb.MongoClient;
const url = 'mongodb://mongodb:27017/todo_app';

module.exports = {
  update: (event, context) => new Promise((resolve, reject) => {
    const data = event.data;
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
                const entry = _.find(docEntries, e => e.id === event.extensions.request.query.id);
                const newEntry = _.cloneDeep(entry);
                _.assign(newEntry, data, { id: uuid.v1(), updatedAt: new Date().getTime() });
                doc.updateOne(entry, { $set: newEntry }, (uerr) => {
                  if (uerr) {
                    reject(uerr);
                  } else {
                    db.close();
                    resolve(JSON.stringify(newEntry));
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
