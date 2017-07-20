'use strict';

const fs = require('fs');

function rm(p) {
  if (fs.existsSync(p)) {
    if (fs.lstatSync(p).isFile()) {
      fs.unlinkSync(p);
    } else {
      fs.readdirSync(p).forEach((file) => {
        const curPath = `${p}/${file}`;
        if (fs.lstatSync(curPath).isDirectory()) { // recurse
          rm(curPath);
        } else { // delete file
          fs.unlinkSync(curPath);
        }
      });
      fs.rmdirSync(p);
    }
  }
}

module.exports = rm;
