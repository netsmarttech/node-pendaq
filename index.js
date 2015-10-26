/**
 *
 * @module node-pendaq
 */

var usb = require('usb');
var events = require('events');
var util = require('util');

var ids = require('./ids.json');
var PenDaq = require('./pendaq.js');

function PenDaqManager() {
  this.devices = [];

  events.call(this);

  usb.on('attach', checkNewDevice.bind(this));
  usb.on('detach', checkRemoveDevice.bind(this));

  process.nextTick(init.bind(this));
};

util.inherits(PenDaqManager, events);

PenDaqManager.prototype.getDevices = function() {
  return this.devices;
};

PenDaqManager.prototype.getDevice = function (dev) {
  if(!dev) {
    return null;
  }

  return new PenDaq(dev);
};

module.exports = new PenDaqManager();

function init() {
  var self = this;
  var usbDevs = usb.getDeviceList();

  usbDevs.forEach(function(elm, idx, arr) {
    checkNewDevice.call(self, elm);
  });
}

function checkNewDevice(dev) {
  var matchIDs = false;
  var newDev = true;
  var i;

  if (!dev || !dev.deviceDescriptor) return;

  //check if matches our array of IDs
  for (i = 0; i < ids.usbIDs.length; i++) {
    if (matchVidPid(ids.usbIDs[i], dev.deviceDescriptor)) {
      matchIDs = true;
      break;
    }
  }

  if (matchIDs) {
    //then, check if it's not already in our list by busNumber and deviceAddress
    for (i = 0; i < this.devices.length; i++) {
      if (matchVidPid(this.devices[i].deviceDescriptor, dev.deviceDescriptor)) {
        newDev = false;
        break;
      }
    }

    if (newDev) {
      this.devices.push(dev);
      this.emit('attach', dev);
    }
  }
}

function checkRemoveDevice(dev) {
  var i;

  if (!dev || !dev.deviceDescriptor) return;

  for (i = 0; i < this.devices.length; i++) {
    if (this.devices[i].busNumber == dev.busNumber && this.devices[i].deviceAddress == dev.deviceAddress) {

      this.devices.splice(i, 1); //removes from array
      this.emit('detach', dev);

      return;
    }
  }
}

function matchVidPid(desc1, desc2) {
  if (!desc1 || !desc2) {
    return false;
  }

  return (desc1.idVendor == desc2.idVendor && desc1.idProduct == desc2.idProduct);
}
