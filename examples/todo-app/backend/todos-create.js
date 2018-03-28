'use strict';

const mongodb = require('mongodb');
const uuid = require('uuid');

const MongoClient = mongodb.MongoClient;
const url = 'mongodb://mongodb:27017/todo_app';

module.exports = {
  create: (event, context) => new Promise((resolve, reject) => {
      const data = event.data;
      data.id = uuid.v1();
      data.updatedAt = new Date().getTime();
      MongoClient.connect(url, (cerr, db) => {
        if (cerr) {
          reject(cerr);
        } else {
          db.collection('todos').insertOne(data, (errInsert) => {
            if (errInsert) {
              reject(errInsert);
            } else {
              resolve(JSON.stringify(data));
              db.close();
            }
          });
        }
    });
  }),
};
