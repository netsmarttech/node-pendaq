/*
   Copyright 2016 Smart-Tech Controle e Automação

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

'use strict';

var PenDaq = require('.');
var dgram = require('dgram');

const HOST = '127.0.0.1';
const PORT = 36000;

function runServer(p) {
  p.open();
  console.log("Connected to PenDAq");

  p.getSerialNumber(function (err, ser) {
    console.log("PenDaq serial number is [%s]", ser);
  });

  var socket = dgram.createSocket('udp4');

  var bSize = 600;
  var bIndex = 0;
  var buf = [
    new Buffer(bSize*2 + 4),
    new Buffer(bSize*2 + 4),
    new Buffer(bSize*2 + 4),
    new Buffer(bSize*2 + 4)
  ];

  //channel number
  buf[0].writeUInt16LE(1, 0);
  buf[1].writeUInt16LE(2, 0);
  buf[2].writeUInt16LE(3, 0);
  buf[3].writeUInt16LE(4, 0);
  //size
  buf[0].writeUInt16LE(bSize, 2);
  buf[1].writeUInt16LE(bSize, 2);
  buf[2].writeUInt16LE(bSize, 2);
  buf[3].writeUInt16LE(bSize, 2);

  function sendBuffer(i) {
    socket.send(buf[i], 0, buf[i].length, PORT, HOST, function (err, bytes) {
      if(err) throw err;
    });
  }

  function onData(vals){
    buf[0].writeUInt16LE(vals[0], 4 + bIndex*2);
    buf[1].writeUInt16LE(vals[1], 4 + bIndex*2);
    buf[2].writeUInt16LE(vals[2], 4 + bIndex*2);
    buf[3].writeUInt16LE(vals[3], 4 + bIndex*2);
    bIndex++;

    if(bIndex >= bSize){
      bIndex = 0;
      sendBuffer(0);
      sendBuffer(1);
      sendBuffer(2);
      sendBuffer(3);
      console.log("Sending buffer", buf[0]);
    }
  }

  function onRawData(buffer) {
    if(!buffer) return;
    console.log("Sending buffer", buffer);

    socket.send(buffer, 0, buffer.length, PORT, HOST, function (err, bytes) {
      if(err) throw err;
    });
  }

  //p.on('data', onData);
  p.on('rawdata', onRawData);

  p.start();

  process.on('SIGINT', function () {
    console.log("SIGINT triggerd");
    p.close();
    socket.close();
    socket.unref();
    PenDaq.end();
    setTimeout(function () {
      console.log("Requests:", require('util').inspect(process._getActiveRequests()));
      console.log("Handles", require('util').inspect(process._getActiveHandles()));
    }, 5000).unref();
  });
}

function getDev() {
  var devs = PenDaq.getAvailableDevices();

  if (devs.length < 1) {
    console.log("No PenDAq connected, exiting");
    process.exit(1);
  }

  return PenDaq.getDevice(devs[0]);
}

function main() {
  var p = getDev();
  runServer(p);
}

main();
