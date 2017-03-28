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

/**
 *
 * @module node-pendaq
 */

var usb = require('usb');
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var ids = require('./ids.json');
var PenDaq = require('./pendaq.js');

// TODO document events

var devices = [];
var ee = new EventEmitter();

function matchVidPid(desc1, desc2) {
  if (!desc1 || !desc2) {
    return false;
  }

  return (desc1.idVendor == desc2.idVendor && desc1.idProduct == desc2.idProduct);
}

function matchDeviceAddresses(dev1, dev2) {
  if (!dev1 || !dev2) {
    return false;
  }

  return (dev1.busNumber
      && dev1.deviceAddress
      && dev1.busNumber === dev2.busNumber
      && dev1.deviceAddress === dev2.deviceAddress);
}

function checkNewDevice(dev) {
  var matchIDs = false;
  var newDev = true;
  var pendaq;
  var i;

  if (!dev || !dev.deviceDescriptor) return;

  //check if matches our array of IDs
  for (i = 0; i < ids.usbIDs.length; i++) {
    if (matchVidPid(ids.usbIDs[i], dev.deviceDescriptor)) {
      matchIDs = true;
      break;
    }
  }

  if (!matchIDs) return;

  //then, check if it's not already in our list by busNumber and deviceAddress
  for (i = 0; i < devices.length; i++) {
    if (matchDeviceAddresses(devices[i]._device, dev)) {
      newDev = false;
      break;
    }
  }

  if(!newDev) return;

  pendaq = new PenDaq(dev);
  devices.push(pendaq);
  ee.emit('connected', pendaq);
}

function checkRemoveDevice(dev) {
  var i;

  if (!dev || !dev.deviceDescriptor) return;

  for (i = 0; i < devices.length; i++) {
    if (matchDeviceAddresses(devices[i]._device, dev)) {
      devices[i]._onDisconnect();
      devices.splice(i, 1); //removes from array
      ee.emit('disconnected', devices[i]);

      return;
    }
  }
}


function getAvailableDevices() {
  var devs = [];
  devices.forEach(function (elm) {
    devs.push(elm._device.busNumber + '.' + elm._device.deviceAddress);
  });

  return devs;
};

function getDevice(id) {
  var dev;
  if(!id) {
    return;
  }

  devices.forEach(function (elm) {
    if(id == (elm._device.busNumber + '.' + elm._device.deviceAddress)) dev = elm;
  });

  return dev;
};

function end() {
  usb.removeListener('attach', checkNewDevice);
  usb.removeListener('detach', checkRemoveDevice);
}

function init() {
  var usbDevs = usb.getDeviceList();

  usbDevs.forEach(function(elm, idx, arr) {
    checkNewDevice(elm);
  });

  usb.on('attach', checkNewDevice);
  usb.on('detach', checkRemoveDevice);

};
init();

module.exports.on = ee.on;
module.exports.end = end;
module.exports.getDevice = getDevice;
module.exports.getAvailableDevices = getAvailableDevices;
module.exports.PenDaq = PenDaq;
