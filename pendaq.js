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

  if (!dev || !dev.deviceDescriptor) throw new TypeError("Expected a usb device");

  //init vars:
  this.device = device;
  this.isOpen = false;
  this.isRunning = false;
  this.iface_ctl;
  this.iface_data;
  this.endpoint_ctl;
  this.endpoint_dataIn;
  this.endpoint_dataOut;

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
  if (this.isOpen) {
    return;
  }

  try {
    this.device.open();

    this.iface_ctl = this.device.interface(IFACE_CTL);
    this.iface_data = this.device.interface(IFACE_DATA);

    this.iface_ctl.detachKernelDriver();

    this.endpoint_ctl = this.iface_ctl.endpoint(ENDPOINT_CTL);
    this.endpoint_dataIn = this.iface_data.endpoint(ENDPOINT_DATA_IN);
    this.endpoint_dataOut = this.iface_data.endpoint(ENDPOINT_DATA_OUT);

    this.iface_ctl.claim();
    this.iface_data.claim();

    //set error listeners
    this.endpoint_ctl.on('error', this.on.bind(this, 'error'));
    this.endpoint_dataIn.on('error', this.on.bind(this, 'error'));
    this.endpoint_dataOut.on('error', this.on.bind(this, 'error'));

    //set data listener
    this.endpoint_dataIn.on('data', function incomingData(data) {
      this.emit('rawdata', data);
      this.onRawData(data);
    }.bind(this));

    this.endpoint_dataIn.startPoll();

    this.isOpen = true;

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

  if (!this.isOpen) {
    return;
  }

  //if the capture is running, first stop and then call us again
  if (this.isRunning) {
    this.stop(function(err) {
      if (!callbackError(err, cb, err, self)) {
        self.close(cb);
      }
    });
    return;
  }

  try {
    //this will automatically stop polling
    this.iface_data.release(true, function(err) {
      if (err) {
        self.emit('error', err);
        return;
      }

      self.iface_ctl.release(true, function(err) {
        if (err) {
          self.emit('error', err);
          return;
        }

        self.iface_ctl.attachKernelDriver();
        self.device.close();
        self.isOpen = false;

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

  if (callbackError(!this.isOpen, cb, new Error("The device must be opened before"))) return;

  //SET CONTROL LINE STATE(0x22) request, as per USB CDC/ACM specification
  //0b11: Activate carrier; DTE present
  this.device.controlTransfer(0x21, 0x22, 3, 0, new Buffer(0), function(err) {
    if (!callbackError(err, cb, err, self)) {

      self.isRunning = true;
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

  if (callbackError(!this.isOpen, cb, new Error("The device must be opened before"))) {
    return;
  }

  //SET CONTROL LINE STATE(0x22) request, as per USB CDC/ACM specification
  //0b00: Deactivate carrier; DTE not present
  this.device.controlTransfer(0x21, 0x22, 0, 0, new Buffer(0), function(err) {
    if (!callbackError(err, cb, err, self)) {

      self.isRunning = false;
      emitOnce('stop', cb, self);
    }
  });
}

/**
 * This function is called by the underlying usb stack when new data is
 * available. Shouldn't be called externally.
 *
 * @method function
 * @param  {[type]} data the Buffer containing raw binary data from the device
 * @fires PenDaq#data
 */
PenDaq.prototype.onRawData = function(data) {
  var i, an1, an2, an3, an4, chksum;

  if (!(data instanceof Buffer)) throw new TypeError("parameter must be of type Buffer");

  //parse buffer
  for (i = 0; i < data.length;) {
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

  device.getStringDescriptor(device.deviceDescriptor.iManufacturer, callback);
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

  device.getStringDescriptor(device.deviceDescriptor.iProduct, callback);
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

  device.getStringDescriptor(device.deviceDescriptor.iSerialNumber, callback);
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
