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

var util = require('util');
var events = require('events');

/** @constant {number} the control interface number */
const IFACE_CTL = 0;
/** @constant {number} the data interface number */
const IFACE_DATA = 1;
/** @constant {number} the control endpoint number */
const ENDPOINT_CTL = 0x81;
/** @constant {number} the data in endpoint number */
const ENDPOINT_DATA_IN = 0x82;
/** @constant {number} the data out endpoint number */
const ENDPOINT_DATA_OUT = 0x02;

/**
 * Emitted when the device is open and ready for data aquisiton
 *
 * @event PenDaq#open
 */

/**
 * Emitted when the device is closed
 *
 * @event PenDaq#close
 */

/**
 * Emitted when the data acquisition is started
 *
 * @event PenDaq#start
 */

/**
 * Emitted when the data acquisition is stopped
 *
 * @event PenDaq#stop
 */

/**
 * Emitted whenever a new sample data is available. An array with the sampled
 * data is passed, one value per sampling channel.
 *
 * @event PenDaq#data
 * @property {number[]} data an array with the sampled values
 */

/**
 * Emitted when binary data arrives from the device. Use this if you want to
 * read the checksum values, for example.
 *
 * @event PenDaq#rawdata
 * @property {Buffer} buffer a Buffer containing the raw data from the device
 */

/**
 * Emitted whenever an error occur while interacting with the device
 *
 * @event PenDaq#error
 * @property {Object} err typically an Error object representing the error occured
 */

////////////////////////////////////////////////////////////////////////////////

/**
 * Represents a PenDAq device
 *
 * @class PenDaq
 * @param {Object} device a usb device representing the PenDAq
 * @since 1.0.0
 */
function PenDaq(device) {

  if (!device || !device.deviceDescriptor) throw new TypeError("Expected a usb device");

  //init vars:
  this._device = device;
  this._isOpen = false;
  this._isRunning = false;
  this._isConnected = true;
  this._iface_ctl;
  this._iface_data;
  this._endpoint_ctl;
  this._endpoint_dataIn;
  this._endpoint_dataOut;

  events.call(this);
}

util.inherits(PenDaq, events);

/**
 * Opens the device. Calling this on an already opened device will have no
 * effect
 *
 * @method open
 * @param {Function} cb this parameter will be added as once listener to the 'open' event
 * @fires PenDaq#open
 */
PenDaq.prototype.open = function open(cb) {
  if (this._isOpen || !this._isConnected) {
    return;
  }

  try {
    this._device.open();

    this._iface_ctl = this._device.interface(IFACE_CTL);
    this._iface_data = this._device.interface(IFACE_DATA);

    //*
    if(process.platform == 'linux' && this._iface_ctl.isKernelDriverActive()){
      this._iface_ctl.detachKernelDriver();
    }
    //*/

    this._endpoint_ctl = this._iface_ctl.endpoint(ENDPOINT_CTL);
    this._endpoint_dataIn = this._iface_data.endpoint(ENDPOINT_DATA_IN);
    this._endpoint_dataOut = this._iface_data.endpoint(ENDPOINT_DATA_OUT);

    this._iface_ctl.claim();
    this._iface_data.claim();

    //set error listeners
    this._endpoint_ctl.on('error', this.emit.bind(this, 'error'));
    this._endpoint_dataIn.on('error', this.emit.bind(this, 'error'));
    this._endpoint_dataOut.on('error', this.emit.bind(this, 'error'));

    //set data listener
    this._endpoint_dataIn.on('data', function incomingData(data) {
      this.emit('rawdata', data);
      this._onRawData(data);
    }.bind(this));

    this._endpoint_dataIn.startPoll();

    this._isOpen = true;

    emitOnce('open', cb, this);
  } catch (err) {
    callbackError(err, cb, err, this);
  }
};

/**
 * Closes this device. If the device is already closed, it will have no effet.
 * If the data acquisition is running, first stop it and then closes the device,
 * giving back the control of the device to the OS.
 *
 * @method close
 * @param {Function} cb this parameter will be added as once listener to the 'close' event
 * @fires PenDaq#close
 */
PenDaq.prototype.close = function close(cb) {
  var self = this;

  if (!this._isOpen || !this._isConnected) {
    emitOnce('close', cb, self);
	return;
  }

  //if the capture is running, first stop and then call us again
  if (this._isRunning) {
    this.stop(function(err) {
      if (!callbackError(err, cb, err, self)) {
        self.close(cb);
      }
    });
    return;
  }

  try {
    //this will automatically stop polling
    this._iface_data.release(true, function(err) {
      if (err) {
        self.emit('error', err);
        return;
      }

      self._iface_ctl.release(true, function(err) {
        if (err) {
          self.emit('error', err);
          return;
        }

        //*
        if(process.platform == 'linux' && !self._iface_ctl.isKernelDriverActive()){
          self._iface_ctl.attachKernelDriver();
        }
        //*/
        self._device.close();
        self._isOpen = false;

        emitOnce('close', cb, self);
      });
    });
  } catch (err) {
    this.emit('error', err);
  }
};

/**
 * Starts the data acquisition.
 *
 * @method start
 * @param {Function} cb this parameter will be added as once listener to the 'start' event
 * @fires PenDaq#start
 */
PenDaq.prototype.start = function start(cb) {
  var self = this;

  if (callbackError(!this._isOpen, cb, new Error("The device must be opened before"))) return;
  if (callbackError(!this._isConnected, cb, new Error("Device not connected"))) return;

  //SET CONTROL LINE STATE(0x22) request, as per USB CDC/ACM specification
  //0b11: Activate carrier; DTE present
  this._device.controlTransfer(0x21, 0x22, 3, 0, new Buffer(0), function(err) {
    if (!callbackError(err, cb, err, self)) {

      self._isRunning = true;
      emitOnce('start', cb, self);
    }
  });
};

/**
 * Stops data acquisition
 * @method stop
 * @param  {Function} cb this parameter will be added as once listener to the 'stop' event
 * @fires PenDaq#stop
 */
PenDaq.prototype.stop = function stop(cb) {
  var self = this;

  if (callbackError(!this._isOpen, cb, new Error("The device must be opened before"))) {
    return;
  }
  if (callbackError(!this._isConnected, cb, new Error("Device not connected"))) return;

  //SET CONTROL LINE STATE(0x22) request, as per USB CDC/ACM specification
  //0b00: Deactivate carrier; DTE not present
  this._device.controlTransfer(0x21, 0x22, 0, 0, new Buffer(0), function(err) {
    if (!callbackError(err, cb, err, self)) {

      self._isRunning = false;
      emitOnce('stop', cb, self);
    }
  });
}

/**
 * This function is called by the underlying usb stack when the deivce is removed
 * it shouldn't be called externally.
 *
 * @method function
 * @fires PenDaq#disconnected
 */
PenDaq.prototype._onDisconnect = function(){
  this._isConnected = false
  this.emit('disconnected');
}

/**
 * This function is called by the underlying usb stack when new data is
 * available. Shouldn't be called externally.
 *
 * @method function
 * @param  {[type]} data the Buffer containing raw binary data from the device
 * @fires PenDaq#data
 */
PenDaq.prototype._onRawData = function(data) {
  var i, an1, an2, an3, an4, chksum;

  if (!(data instanceof Buffer)) throw new TypeError("parameter must be of type Buffer");

  //console.log('oRD:', data.toString('hex'));

  //parse buffer
  for (i = 0; i < data.length;) {

    if(i + 9 > data.length) break;

    an1 = data.readUInt16LE(i);
    i += 2;
    an2 = data.readUInt16LE(i);
    i += 2;
    an3 = data.readUInt16LE(i);
    i += 2;
    an4 = data.readUInt16LE(i);
    i += 2;
    chksum = data.readUInt8(i);
    i++;

    if (((an1 + an2 + an3 + an4) & 0xFF) == chksum) {
      //data OK
      this.emit('data', [an1, an2, an3, an4])
    } else {
      //data NOK
      this.emit('error', new Error("Checksum code does not match the calculated code"));
    }
  }
};

/**
 * This callback is called when the reuested String Descriptor is available
 *
 * @callback PenDaq~stringDescriptorCallback
 * @param {string} str the value of the requested string
 * @see getManufacturer
 * @see getProductName
 * @see getSerialNumber
 */

/**
 * Provides the device's Manufacturer descriptor as the parameter of the
 * callback function
 *
 * @method function
 * @param  {PenDaq~stringDescriptorCallback} callback
 */
PenDaq.prototype.getManufacturer = function(callback) {
  if (!callback || typeof callback !== 'function') return;

  this._device.getStringDescriptor(this._device.deviceDescriptor.iManufacturer, callback);
};

/**
 * Provides the device's ProductName descriptor as the parameter of the
 * callback function
 *
 * @method function
 * @param  {PenDaq~stringDescriptorCallback} callback
 */
PenDaq.prototype.getProductName = function(callback) {
  if (!callback || typeof callback !== 'function') return;

  this._device.getStringDescriptor(this._device.deviceDescriptor.iProduct, callback);
};


/**
 * Provides the device's SerialNumber descriptor as the parameter of the
 * callback function
 *
 * @method function
 * @param  {PenDaq~stringDescriptorCallback} callback
 */
PenDaq.prototype.getSerialNumber = function(callback) {
  if (!callback || typeof callback !== 'function') return;

  this._device.getStringDescriptor(this._device.deviceDescriptor.iSerialNumber, callback);
};

module.exports = PenDaq;

// helpers

function emitOnce(evt, f, self) {
  if (typeof f === 'function') {
    self.once(evt, f);
  }

  self.emit(evt);
}

function callbackError(test, cb, arg, self) {
  if (test) {
    if (typeof cb === 'function') {
      process.nextTick(cb, arg);
    }

    if (self) {
      self.emit('error', arg);
    }

    return true;
  }
  return false;
}
