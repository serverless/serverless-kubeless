'use strict';

const mongodb = require('mongodb');
const uuid = require('uuid');

const MongoClient = mongodb.MongoClient;
const url = 'mongodb://mongodb:27017/todo_app';

module.exports = {
  create: (req, res) => new Promise((resolve, reject) => {
    res.header('Access-Control-Allow-Origin', '*');
    const body = [];
    req.on('data', d => body.push(d));
    req.on('end', () => {
      const data = JSON.parse(Buffer.concat(body));
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
              res.end(JSON.stringify(data));
              resolve();
              db.close();
            }
          });
        }
      });
    });
  }),
};
