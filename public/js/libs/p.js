;(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var JSONProtocol = require('./JSONProtocol.js'),
    its = require('its'),
    Emitter = require('events').EventEmitter;

function notImplemented(){
    throw new Error('This method is not implemented');
}

function Connection(address, peers, options){
    its.string(address);
    its.defined(peers);

    this.address = address;
    this.peers = peers;

    if(options){
        if(options.emitter) this.emitter = options.emitter;
        if(options.firewall) this.acceptRTCConnection = options.firewall;
    }

    if(!this.emitter) this.emitter = new Connection.Emitter();
}

// Circular dependency solved in WebRTCConnection.js
Connection.createWebRTCConnection = null;
Connection.Emitter = Emitter;

Connection.prototype = Object.create(JSONProtocol.prototype);

Connection.prototype.on = function(){
    this.emitter.on.apply(this.emitter, arguments);
    return this;
};

Connection.prototype.removeListener = function(){
    this.emitter.removeListener.apply(this.emitter, arguments);
    return this;
};

Connection.prototype.send = JSONProtocol.prototype.writeMessage;

Connection.prototype.getPeer = function(address){
    return this.peers.get(address);
};

Connection.prototype.addPeer = function(peer){
    return this.peers.add(peer);
};

Connection.prototype.getPeers = function() {
    return this.peers.get();
};

function isString(candidate){
    return Object.prototype.toString.call(candidate) === '[object String]';
}

Connection.prototype.connect = function(config){
    if(isString(config)){
        config = {address: config};
    }

    var self = this,
        firewall = config.firewall || this.firewall,
        peer = Connection.createWebRTCConnection(config, this.peers, this, {firewall: firewall});

    peer.writeOffer(config);

    this.peers.add(peer);

    peer.on('close', function(){
        self.peers.remove(peer);
        self.emitter.emit('disconnection', peer);
    });

    this.emitter.emit('connection', peer);

    return peer;
};

Connection.prototype.readMessage = function(message){
    this.emitter.emit('message', message);
};

Connection.prototype.readArrayBuffer = function(message){
    this.emitter.emit('arraybuffer', message);
};

Connection.prototype.acceptRTCConnection = function(description, data){
    return true;
};

Connection.prototype.readRelay = function(peerAddress, message){
    var peer = this.getPeer(peerAddress);

    if(!peer){
        this.emitter.emit('error', new Error("Unknown peer at address: " + peerAddress));
        return;
    }

    peer.writeRelayedMessage(this.address, message);
};

Connection.prototype.readRelayedIceCandidate = function(peerAddress, candidate){
    var peer = this.getPeer(peerAddress);

    if(!peer){
        this.emitter.emit('error', new Error("Unknown peer at address: " + peerAddress));
        return;
    }

    peer.readIceCandidate(candidate);
};

Connection.prototype.readRelayedOffer = function(peerAddress, description, data){
    if(!this.acceptRTCConnection(description, data)) return false;

    var self = this,
        peer = Connection.createWebRTCConnection({address:peerAddress}, this.peers, this, {firewall: this.firewall});

    this.addPeer(peer);

    peer.on('close', function(){
        self.peers.remove(peer);
        self.emitter.emit('disconnection', peer);
    });

    peer.readOffer(description);
    peer.writeAnswer();

    this.emitter.emit('connection', peer);
};

Connection.prototype.readRelayedAnswer = function(peerAddress, description){
    var peer = this.getPeer(peerAddress);

    if(!peer){
        this.emitter.emit('error', new Error("Unknown peer at address: " + peerAddress));
        return;
    }

    peer.readAnswer(description);
};

Connection.prototype.close = notImplemented; // implemented higher up
Connection.prototype.getReadyState = notImplemented; // implemented higher up

Connection.prototype.isOpen = function(){
    return this.getReadyState() === 'open';
};

module.exports = Connection;

},{"./JSONProtocol.js":3,"events":9,"its":11}],2:[function(require,module,exports){
var its = require('its');

function noop(){}

function ConnectionManager(){
    this.connectionMap = {};
    this.connectionList = [];
}

ConnectionManager.prototype.get = function(address){
    if(address === undefined) return this.connectionList.slice();

    return this.connectionMap[address];
};

ConnectionManager.prototype.add = function(connection) {
    its.defined(connection);

    var address = connection.address;
    its.string(address);

    if(address in this.connectionMap) return false;

    this.connectionMap[address] = connection;
    this.connectionList.push(connection);

    this.onAdd(connection);
    return true;
};
ConnectionManager.prototype.onAdd = noop;

ConnectionManager.prototype.remove = function(connection){
    its.defined(connection);

    var address = connection.address;
    its.string(address);

    var mappedConnection = this.connectionMap[address];
    if(!mappedConnection || mappedConnection !== connection) return false;

    delete this.connectionMap[address];

    var index = this.connectionList.indexOf(connection);
    this.connectionList.splice(index, 1);

    this.onRemove(connection);
    return true;
};
ConnectionManager.prototype.onRemove = noop;

module.exports = ConnectionManager;
},{"its":11}],3:[function(require,module,exports){
function notImplemented(){
    throw new Error('This method is not implemented');
}

function JSONProtocol(){}

JSONProtocol.prototype.PROTOCOL_NAME = 'p';

JSONProtocol.prototype.MESSAGE_TYPE = {
    DIRECT: 0, // [0, message]

    RTC_OFFER: 3, // [3, description, data]
    RTC_ANSWER: 4, // [4, description]
    RTC_ICE_CANDIDATE: 5, // [5, candidate]

    RELAY: 6, // [6, address, message]
    RELAYED: 7 // [7, address, message]
};

JSONProtocol.prototype.readRaw = function(message){
    if(message instanceof ArrayBuffer){
        this.readArrayBuffer(message);
    } else {
        this.readProtocolMessage(JSON.parse(message));
    }
};

JSONProtocol.prototype.readProtocolMessage = function(message){
    var MESSAGE_TYPE = this.MESSAGE_TYPE,
        messageType = message[0];

    switch(messageType){
        // This is a message from the remote node to this one.
        case MESSAGE_TYPE.DIRECT:
            this.readMessage(message[1]);
            break;

        // The message was relayed by the peer on behalf of
        // a third party peer, identified by "thirdPartyPeerId".
        // This means that the peer is acting as a signalling
        // channel on behalf of the third party peer.
        case MESSAGE_TYPE.RELAYED:
            this.readRelayedMessage(message[1], message[2]);
            break;

        // The message is intended for another peer, identified
        // by "peerId", which is also connected to this node.
        // This means that the peer is using this connection
        // as a signalling channel in order to establish a connection
        // to the other peer identified "peerId".
        case MESSAGE_TYPE.RELAY:
            this.readRelay(message[1], message[2]);
            break;

        default:
            throw new Error('Unknown message type: ' + messageType);
    }
};

JSONProtocol.prototype.readRelayedMessage = function(origin, message){
    var MESSAGE_TYPE = this.MESSAGE_TYPE,
        messageType = message[0];

    switch(messageType){
        // An initial connection request from a third party peer
        case MESSAGE_TYPE.RTC_OFFER:
            this.readRelayedOffer(origin, message[1], message[2]);
            break;

        // An answer to an RTC offer sent from this node
        case MESSAGE_TYPE.RTC_ANSWER:
            this.readRelayedAnswer(origin, message[1]);
            break;

        // An ICE candidate from the source node
        case MESSAGE_TYPE.RTC_ICE_CANDIDATE:
            this.readRelayedIceCandidate(origin, message[1]);
            break;

        default:
            throw new Error('Unknown message type: ' + messageType);
    }
};

JSONProtocol.prototype.readMessage = notImplemented;
JSONProtocol.prototype.readArrayBuffer = notImplemented;
JSONProtocol.prototype.readRelay = notImplemented;

JSONProtocol.prototype.readRelayedOffer = notImplemented;
JSONProtocol.prototype.readRelayedAnswer = notImplemented;
JSONProtocol.prototype.readRelayedIceCandidate = notImplemented;

JSONProtocol.prototype.writeRaw = notImplemented;

JSONProtocol.prototype.writeProtocolMessage = function(message){
    var serializedMessage = JSON.stringify(message);
    this.writeRaw(serializedMessage);
};

JSONProtocol.prototype.writeMessage = function(message){
    if(message instanceof ArrayBuffer){
        this.writeRaw(message);
    } else {
        this.writeStringMessage(message);
    }
};

JSONProtocol.prototype.writeStringMessage = function(message){
    this.writeProtocolMessage([
        this.MESSAGE_TYPE.DIRECT,
        message
    ]);
};

JSONProtocol.prototype.writeRelayedMessage = function(origin, message){
    this.writeProtocolMessage([
        this.MESSAGE_TYPE.RELAYED,
        origin,
        message
    ]);
};

JSONProtocol.prototype.writeRelayMessage = function(destination, message){
    this.writeProtocolMessage([
        this.MESSAGE_TYPE.RELAY,
        destination,
        message
    ]);
};

JSONProtocol.prototype.writeRelayAnswer = function(destination, description){
    this.writeRelayMessage(destination, [
        this.MESSAGE_TYPE.RTC_ANSWER,
        description
    ]);
};

JSONProtocol.prototype.writeRelayIceCandidate = function(destination, candidate){
    this.writeRelayMessage(destination, [
        this.MESSAGE_TYPE.RTC_ICE_CANDIDATE,
        candidate
    ]);
};

JSONProtocol.prototype.writeRelayOffer = function(destination, description, data){
    this.writeRelayMessage(destination, [
        this.MESSAGE_TYPE.RTC_OFFER,
        description,
        data
    ]);
};

module.exports = JSONProtocol;
},{}],4:[function(require,module,exports){
var Emitter = require('events').EventEmitter,
    ConnectionManager = require('./ConnectionManager.js'),
    WebSocketConnection = require('./WebSocketConnection.js'),
    WebRTCConnection = require('./WebRTCConnection.js'),
    its = require('its');

function P(emitter, connectionManager, options){
    its.defined(emitter);
    its.defined(connectionManager);

    this.emitter = emitter;
    this.peers = connectionManager;

    this.peers.onAdd = function(peer){
        emitter.emit('connection', peer);
    };

    this.peers.onRemove = function(peer){
        emitter.emit('disconnection', peer);
    };

    if(options && options.firewall) this.firewall = options.firewall;
}

P.create = function(options){
    var emitter = new Emitter(),
        connectionManager = new ConnectionManager();

    return new P(emitter, connectionManager, options);
};

P.prototype.getPeers = function(){
    return this.peers.get();
};

P.prototype.connect = function(address){
    its.string(address);

    var peers = this.peers,
        peer = WebSocketConnection.create(address, this.peers, {firewall: this.firewall});

    peers.add(peer);

    peer.on('close', function(){
        peers.remove(peer);
    });

    return peer;
};

P.prototype.on = function(){
    this.emitter.on.apply(this.emitter, arguments);
    return this;
};

P.prototype.removeListener = function(){
    this.emitter.removeListener.apply(this.emitter, arguments);
    return this;
};

module.exports = P;
},{"./ConnectionManager.js":2,"./WebRTCConnection.js":5,"./WebSocketConnection.js":6,"events":9,"its":11}],5:[function(require,module,exports){
var Connection = require('./Connection.js'),
    its = require('its');

var nativeRTCPeerConnection = (typeof RTCPeerConnection !== 'undefined')? RTCPeerConnection :
                              (typeof webkitRTCPeerConnection !== 'undefined')? webkitRTCPeerConnection :
                              (typeof mozRTCPeerConnection !== 'undefined')? mozRTCPeerConnection :
                              undefined;

var nativeRTCSessionDescription = (typeof RTCSessionDescription !== 'undefined')? RTCSessionDescription :
                                  (typeof mozRTCSessionDescription !== 'undefined')? mozRTCSessionDescription :
                                  undefined;
var nativeRTCIceCandidate = (typeof RTCIceCandidate !== 'undefined')? RTCIceCandidate :
                            (typeof mozRTCIceCandidate !== 'undefined')? mozRTCIceCandidate :
                            undefined;

function WebRTCConnection(address, peers, rtcConnection, signalingChannel, options){
    var self = this;

    its.string(address);
    its.defined(peers);
    its.defined(rtcConnection);
    its.defined(signalingChannel);

    Connection.call(this, address, peers, options);

    this.signalingChannel = signalingChannel;
    this.rtcConnection = rtcConnection;
    this.rtcDataChannel = rtcConnection.createDataChannel(this.PROTOCOL_NAME, {reliable: false});

    this.close = rtcConnection.close.bind(rtcConnection);

    this.rtcConnection.addEventListener('icecandidate', function(event){
        if(!event.candidate) return;

        self.signalingChannel.writeRelayIceCandidate(address, event.candidate);
    });

    this.rtcDataChannel.addEventListener('message', function(message){
        self.readRaw(message.data);
    });

    this.rtcDataChannel.addEventListener('open', function(event){
        self.emitter.emit('open', event);
    });

    this.rtcDataChannel.addEventListener('error', function(event){
        self.emitter.emit('error', event);
    });

    this.rtcDataChannel.addEventListener('close', function(event){
        self.emitter.emit('close', event);
    });
}

var DEFAULT_RTC_CONFIGURATION = {'iceServers': [
    {url: 'stun:stun01.sipphone.com'},
    {url: 'stun:stun.ekiga.net'},
    {url: 'stun:stun.fwdnet.net'},
    {url: 'stun:stun.ideasip.com'},
    {url: 'stun:stun.iptel.org'},
    {url: 'stun:stun.rixtelecom.se'},
    {url: 'stun:stun.schlund.de'},
    {url: 'stun:stun.l.google.com:19302'},
    {url: 'stun:stun1.l.google.com:19302'},
    {url: 'stun:stun2.l.google.com:19302'},
    {url: 'stun:stun3.l.google.com:19302'},
    {url: 'stun:stun4.l.google.com:19302'},
    {url: 'stun:stunserver.org'},
    {url: 'stun:stun.softjoys.com'},
    {url: 'stun:stun.voiparound.com'},
    {url: 'stun:stun.voipbuster.com'},
    {url: 'stun:stun.voipstunt.com'},
    {url: 'stun:stun.voxgratia.org'},
    {url: 'stun:stun.xten.com'},
    {
        url: 'turn:numb.viagenie.ca',
        credential: 'muazkh',
        username: 'webrtc@live.com'
    },
    {
        url: 'turn:192.158.29.39:3478?transport=udp',
        credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
        username: '28224511:1379330808'
    },
    {
        url: 'turn:192.158.29.39:3478?transport=tcp',
        credential: 'JZEOEt2V3Qb0y27GRntt2u2PAYA=',
        username: '28224511:1379330808'
    }
]};
var DEFAULT_MEDIA_CONSTRAINTS = {
    optional: [{RtpDataChannels: true}],
    mandatory: {
        OfferToReceiveAudio: false,
        OfferToReceiveVideo: false
    }
};

WebRTCConnection.create = function(config, peers, signalingChannel, options){
    var rtcConfiguration = config.rtcConfiguration || DEFAULT_RTC_CONFIGURATION,
        mediaConstraints = config.mediaConstraints || DEFAULT_MEDIA_CONSTRAINTS,
        rtcConnection = new nativeRTCPeerConnection(rtcConfiguration, mediaConstraints);

    return new WebRTCConnection(config.address, peers, rtcConnection, signalingChannel, options);
};

WebRTCConnection.prototype = Object.create(Connection.prototype);

WebRTCConnection.prototype.writeRaw = function(message){
    switch(this.rtcDataChannel.readyState){
        case 'connecting':
            throw new Error('Can\'t send a message while RTCDataChannel connecting');
        case 'open':
            this.rtcDataChannel.send(message);
            break;
        case 'closing':
        case 'closed':
            throw new Error('Can\'t send a message while RTCDataChannel is closing or closed');
    }
};

WebRTCConnection.prototype.readAnswer = function(description){
    var rtcSessionDescription = new nativeRTCSessionDescription(description);

    this.rtcConnection.setRemoteDescription(rtcSessionDescription);
};

WebRTCConnection.prototype.readOffer = function(description){
    var rtcSessionDescription = new nativeRTCSessionDescription(description);

    this.rtcConnection.setRemoteDescription(rtcSessionDescription);
};

WebRTCConnection.prototype.readIceCandidate = function(candidate){
    var emitter = this.emitter;
    this.rtcConnection.addIceCandidate(new nativeRTCIceCandidate(candidate));
};

WebRTCConnection.prototype.writeAnswer = function(){
    var emitter = this.emitter,
        address = this.address,
        rtcConnection = this.rtcConnection,
        signalingChannel = this.signalingChannel;

    function onError(err){ emitter.emit('error', err); }

    rtcConnection.createAnswer(function(description){
        rtcConnection.setLocalDescription(description, function(){
            signalingChannel.writeRelayAnswer(address, description);
        }, onError);
    }, onError);
};

WebRTCConnection.prototype.writeOffer = function(config){
    var emitter = this.emitter,
        address = this.address,
        rtcConnection = this.rtcConnection,
        signalingChannel = this.signalingChannel;

    function onError(err){ emitter.emit('error', err); }

    rtcConnection.createOffer(function(description){
        rtcConnection.setLocalDescription(description, function(){
            signalingChannel.writeRelayOffer(address, description, config.offerData);
        }, onError);
    }, onError, config.mediaConstraints || DEFAULT_MEDIA_CONSTRAINTS);
};

WebRTCConnection.prototype.getReadyState = function(){
    return this.rtcDataChannel.readyState;
};


// Solves the circular dependency with Connection.js
Connection.createWebRTCConnection = WebRTCConnection.create;

module.exports = WebRTCConnection;
},{"./Connection.js":1,"its":11}],6:[function(require,module,exports){
var Connection = require('./Connection.js');

function WebSocketConnection(address, peers, webSocket, options){
    var self = this;

    Connection.call(this, address, peers, options);

    this.webSocket = webSocket;

    this.close = webSocket.close.bind(webSocket);

    this.webSocket.addEventListener('message', function(message){
        self.readRaw(message.data);
    });

    this.webSocket.addEventListener('open', function(event){
        self.emitter.emit('open', event);
    });

    this.webSocket.addEventListener('error', function(event){
        self.emitter.emit('error', event);
    });

    this.webSocket.addEventListener('close', function(event){
        self.emitter.emit('close', event);
    });
}

WebSocketConnection.create = function(address, peers, options){
    var webSocket = new WebSocket(address, WebSocketConnection.prototype.PROTOCOL_NAME);
    return new WebSocketConnection(address, peers, webSocket, options);
};

WebSocketConnection.prototype = Object.create(Connection.prototype);
WebSocketConnection.prototype.writeRaw = function(message){
    switch(this.webSocket.readyState){
        case WebSocket.CONNECTING:
            throw new Error("Can't send a message while WebSocket connecting");

        case WebSocket.OPEN:
            this.webSocket.send(message);
            break;

        case WebSocket.CLOSING:
        case WebSocket.CLOSED:
            throw new Error("Can't send a message while WebSocket is closing or closed");
    }
};

WebSocketConnection.prototype.getReadyState = function(){
    switch(this.webSocket.readyState){
        case WebSocket.CONNECTING:
            return 'connecting';
        case WebSocket.OPEN:
            return 'open';
        case WebSocket.CLOSING:
            return 'closing';
        case WebSocket.CLOSED:
            return 'closed';
    }
};

module.exports = WebSocketConnection;
},{"./Connection.js":1}],7:[function(require,module,exports){
window.P = require('./P.js');

},{"./P.js":4}],8:[function(require,module,exports){


//
// The shims in this file are not fully implemented shims for the ES5
// features, but do work for the particular usecases there is in
// the other modules.
//

var toString = Object.prototype.toString;
var hasOwnProperty = Object.prototype.hasOwnProperty;

// Array.isArray is supported in IE9
function isArray(xs) {
  return toString.call(xs) === '[object Array]';
}
exports.isArray = typeof Array.isArray === 'function' ? Array.isArray : isArray;

// Array.prototype.indexOf is supported in IE9
exports.indexOf = function indexOf(xs, x) {
  if (xs.indexOf) return xs.indexOf(x);
  for (var i = 0; i < xs.length; i++) {
    if (x === xs[i]) return i;
  }
  return -1;
};

// Array.prototype.filter is supported in IE9
exports.filter = function filter(xs, fn) {
  if (xs.filter) return xs.filter(fn);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    if (fn(xs[i], i, xs)) res.push(xs[i]);
  }
  return res;
};

// Array.prototype.forEach is supported in IE9
exports.forEach = function forEach(xs, fn, self) {
  if (xs.forEach) return xs.forEach(fn, self);
  for (var i = 0; i < xs.length; i++) {
    fn.call(self, xs[i], i, xs);
  }
};

// Array.prototype.map is supported in IE9
exports.map = function map(xs, fn) {
  if (xs.map) return xs.map(fn);
  var out = new Array(xs.length);
  for (var i = 0; i < xs.length; i++) {
    out[i] = fn(xs[i], i, xs);
  }
  return out;
};

// Array.prototype.reduce is supported in IE9
exports.reduce = function reduce(array, callback, opt_initialValue) {
  if (array.reduce) return array.reduce(callback, opt_initialValue);
  var value, isValueSet = false;

  if (2 < arguments.length) {
    value = opt_initialValue;
    isValueSet = true;
  }
  for (var i = 0, l = array.length; l > i; ++i) {
    if (array.hasOwnProperty(i)) {
      if (isValueSet) {
        value = callback(value, array[i], i, array);
      }
      else {
        value = array[i];
        isValueSet = true;
      }
    }
  }

  return value;
};

// String.prototype.substr - negative index don't work in IE8
if ('ab'.substr(-1) !== 'b') {
  exports.substr = function (str, start, length) {
    // did we get a negative start, calculate how much it is from the beginning of the string
    if (start < 0) start = str.length + start;

    // call the original function
    return str.substr(start, length);
  };
} else {
  exports.substr = function (str, start, length) {
    return str.substr(start, length);
  };
}

// String.prototype.trim is supported in IE9
exports.trim = function (str) {
  if (str.trim) return str.trim();
  return str.replace(/^\s+|\s+$/g, '');
};

// Function.prototype.bind is supported in IE9
exports.bind = function () {
  var args = Array.prototype.slice.call(arguments);
  var fn = args.shift();
  if (fn.bind) return fn.bind.apply(fn, args);
  var self = args.shift();
  return function () {
    fn.apply(self, args.concat([Array.prototype.slice.call(arguments)]));
  };
};

// Object.create is supported in IE9
function create(prototype, properties) {
  var object;
  if (prototype === null) {
    object = { '__proto__' : null };
  }
  else {
    if (typeof prototype !== 'object') {
      throw new TypeError(
        'typeof prototype[' + (typeof prototype) + '] != \'object\''
      );
    }
    var Type = function () {};
    Type.prototype = prototype;
    object = new Type();
    object.__proto__ = prototype;
  }
  if (typeof properties !== 'undefined' && Object.defineProperties) {
    Object.defineProperties(object, properties);
  }
  return object;
}
exports.create = typeof Object.create === 'function' ? Object.create : create;

// Object.keys and Object.getOwnPropertyNames is supported in IE9 however
// they do show a description and number property on Error objects
function notObject(object) {
  return ((typeof object != "object" && typeof object != "function") || object === null);
}

function keysShim(object) {
  if (notObject(object)) {
    throw new TypeError("Object.keys called on a non-object");
  }

  var result = [];
  for (var name in object) {
    if (hasOwnProperty.call(object, name)) {
      result.push(name);
    }
  }
  return result;
}

// getOwnPropertyNames is almost the same as Object.keys one key feature
//  is that it returns hidden properties, since that can't be implemented,
//  this feature gets reduced so it just shows the length property on arrays
function propertyShim(object) {
  if (notObject(object)) {
    throw new TypeError("Object.getOwnPropertyNames called on a non-object");
  }

  var result = keysShim(object);
  if (exports.isArray(object) && exports.indexOf(object, 'length') === -1) {
    result.push('length');
  }
  return result;
}

var keys = typeof Object.keys === 'function' ? Object.keys : keysShim;
var getOwnPropertyNames = typeof Object.getOwnPropertyNames === 'function' ?
  Object.getOwnPropertyNames : propertyShim;

if (new Error().hasOwnProperty('description')) {
  var ERROR_PROPERTY_FILTER = function (obj, array) {
    if (toString.call(obj) === '[object Error]') {
      array = exports.filter(array, function (name) {
        return name !== 'description' && name !== 'number' && name !== 'message';
      });
    }
    return array;
  };

  exports.keys = function (object) {
    return ERROR_PROPERTY_FILTER(object, keys(object));
  };
  exports.getOwnPropertyNames = function (object) {
    return ERROR_PROPERTY_FILTER(object, getOwnPropertyNames(object));
  };
} else {
  exports.keys = keys;
  exports.getOwnPropertyNames = getOwnPropertyNames;
}

// Object.getOwnPropertyDescriptor - supported in IE8 but only on dom elements
function valueObject(value, key) {
  return { value: value[key] };
}

if (typeof Object.getOwnPropertyDescriptor === 'function') {
  try {
    Object.getOwnPropertyDescriptor({'a': 1}, 'a');
    exports.getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  } catch (e) {
    // IE8 dom element issue - use a try catch and default to valueObject
    exports.getOwnPropertyDescriptor = function (value, key) {
      try {
        return Object.getOwnPropertyDescriptor(value, key);
      } catch (e) {
        return valueObject(value, key);
      }
    };
  }
} else {
  exports.getOwnPropertyDescriptor = valueObject;
}

},{}],9:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var util = require('util');

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!util.isNumber(n) || n < 0)
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (util.isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      } else {
        throw TypeError('Uncaught, unspecified "error" event.');
      }
      return false;
    }
  }

  handler = this._events[type];

  if (util.isUndefined(handler))
    return false;

  if (util.isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (util.isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              util.isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (util.isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (util.isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!util.isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  function g() {
    this.removeListener(type, g);
    listener.apply(this, arguments);
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!util.isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (util.isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (util.isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (util.isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (util.isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (util.isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};
},{"util":10}],10:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var shims = require('_shims');

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};

/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  shims.forEach(array, function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = shims.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = shims.getOwnPropertyNames(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }

  shims.forEach(keys, function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = shims.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }

  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (shims.indexOf(ctx.seen, desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = shims.reduce(output, function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return shims.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) && objectToString(e) === '[object Error]';
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.binarySlice === 'function'
  ;
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = shims.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = shims.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

},{"_shims":8}],11:[function(require,module,exports){
module.exports = require('./lib/its.js');
},{"./lib/its.js":12}],12:[function(require,module,exports){
// Helpers
var slice = Array.prototype.slice;
var toString = Object.prototype.toString;

var templateRegEx = /%s/; // The template placeholder, used to split message templates

/** A basic templating function.

    Takes a string with 0 or more '%s' placeholders and an array to populate it with.

    @param {String} messageTemplate A string which may or may not have 0 or more '%s' to denote argument placement
    @param {Array} [messageArguments] Items to populate the template with

    @example
        templatedMessage("Hello"); // returns "Hello"
        templatedMessage("Hello, %s", ["world"]); // returns "Hello, world"
        templatedMessage("Hello, %s. It's %s degrees outside.", ["world", 72]); // returns "Hello, world. It's 72 degrees outside"

    @returns {String} The resolved message
*/
var templatedMessage = function(messageTemplate, messageArguments){
    var result = [],
        messageArray = messageTemplate.split(templateRegEx),
        index = 0,
        length = messageArray.length;

    for(; index < length; index++){
        result.push(messageArray[index]);
        result.push(messageArguments[index]);
    }

    return result.join('');
};


/** Generic check function which throws an error if a given expression is false
*
*   The params list is a bit confusing, check the examples to see the available ways of calling this function
*
*   @param {Boolean} expression The determinant of whether an exception is thrown
*   @param {String|Object} [messageOrErrorType] A message or an ErrorType object to throw if expression is false
*   @param {String|Object} [messageOrMessageArgs] A message, message template, or a message argument
*   @param {...Object} [messageArgs] Arguments for a provided message template
*
*   @returns {Boolean} Returns the expression passed
*   @throws {Error}
*
*   @example
*       its(0 < 10); // returns true
*       its(0 > 10); // throws Error with no message
*       its(0 > 10, "Something went wrong!"); // throws Error with message: "Something went wrong!"
*       its(0 > 10, "%s went %s!", "something", "wrong"); // throws Error with message: "Something went wrong!"
*       its(0 > 10, RangeError, "%s went %s!", "something", "wrong"); // throws RangeError with message: "Something went wrong!"
*       its(0 > 10, RangeError); // throws RangeError with no message
*/
var its = module.exports = function(expression, messageOrErrorType){
    if(expression === false){
        if(messageOrErrorType && typeof messageOrErrorType !== "string"){ // Check if custom error object passed
            throw messageOrErrorType(arguments.length > 3 ? templatedMessage(arguments[2], slice.call(arguments,3)) : arguments[2]);
        } else {
            throw new Error(arguments.length > 2 ? templatedMessage(messageOrErrorType, slice.call(arguments,2)) : messageOrErrorType);
        }
    }
    return expression;
};

/** Throws a TypeError if a given expression is false
*
*   @param {Boolean} expression The determinant of whether an exception is thrown
*   @param {String} [message] A message or message template for the error (if it gets thrown)
*   @param {...Object} [messageArgs] Arguments for a provided message template
*
*   @returns {Boolean} Returns the expression passed
*   @throws {TypeError}
*
*   @example
*       its.type(typeof "Team" === "string"); // returns true
*       its.type(typeof "Team" === "number"); // throws TypeError with no message
*       its.type(void 0, "Something went wrong!"); // throws TypeError with message: "Something went wrong!"
*       its.type(void 0, "%s went %s!", "something", "wrong"); // throws TypeError with message: "Something went wrong!"
*/
its.type = function(expression, message){
    if(expression === false){
        throw new TypeError(arguments.length > 2 ? templatedMessage(message, slice.call(arguments,2)) : message);
    }
    return expression;
};

// Helpers
its.undefined = function(expression){
    return its.type.apply(null, [expression === void 0].concat(slice.call(arguments, 1)));
};

its.null = function(expression){
    return its.type.apply(null, [expression === null].concat(slice.call(arguments, 1)));
};

its.boolean = function(expression){
    return its.type.apply(null, [expression === true || expression === false || toString.call(expression) === "[object Boolean]"].concat(slice.call(arguments, 1)));
};

its.array = function(expression){
    return its.type.apply(null, [toString.call(expression) === "[object Array]"].concat(slice.call(arguments, 1)));
};

its.object = function(expression){
    return its.type.apply(null, [expression === Object(expression)].concat(slice.call(arguments, 1)));
};

/** This block creates
*   its.function
*   its.string
*   its.number
*   its.date
*   its.regexp
*/
(function(){
    var types = [
            ['args','Arguments'],
            ['func', 'Function'],
            ['string', 'String'],
            ['number', 'Number'],
            ['date', 'Date'],
            ['regexp', 'RegExp']
        ],
        index = 0,
        length = types.length;

    for(; index < length; index++){
        (function(){
            var theType = types[index];
            its[theType[0]] = function(expression){
                return its.type.apply(null, [toString.call(expression) === '[object ' + theType[1] + ']'].concat(slice.call(arguments, 1)));
            };
        }());
    }
}());

// optimization from underscore.js by documentcloud -- underscorejs.org
if (typeof (/./) !== 'function') {
    its.func = function(expression) {
        return its.type.apply(null, [typeof expression === "function"].concat(slice.call(arguments, 1)));
    };
}

/** Throws a ReferenceError if a given expression is false
*
*   @param {Boolean} expression The determinant of whether an exception is thrown
*   @param {String} [message] A message or message template for the error (if it gets thrown)
*   @param {...Object} [messageArgs] Arguments for a provided message template
*
*   @returns {Object} Returns the expression passed
*   @throws {ReferenceError}
*
*   @example
*       its.defined("Something"); // returns true
*       its.defined(void 0); // throws ReferenceError with no message
*       its.defined(void 0, "Something went wrong!"); // throws ReferenceError with message: "Something went wrong!"
*       its.defined(void 0, "%s went %s!", "something", "wrong"); // throws ReferenceError with message: "Something went wrong!"
*/
its.defined = function(expression, message){
    if(expression === void 0){
        throw new ReferenceError(arguments.length > 2 ? templatedMessage(message, slice.call(arguments,2)) : message);
    }

    return expression;
};

/** Throws a RangeError if a given expression is false
*
*   @param {Boolean} expression The determinant of whether an exception is thrown
*   @param {String} [message] A message or message template for the error (if it gets thrown)
*   @param {...Object} [messageArgs] Arguments for a provided message template
*
*   @returns {Boolean} Returns the expression passed
*   @throws {RangeError}
*
*   @example
*       its.range(1 > 0); // returns true
*       its.range(1 < 2); // throws RangeError with no message
*       its.range(1 < 2 && 1 > 2, "Something went wrong!"); // throws RangeError with message: "Something went wrong!"
*       its.range(1 < 2 && 1 > 2, "%s went %s!", "something", "wrong"); // throws RangeError with message: "Something went wrong!"
*/
its.range = function(expression, message){
    if(expression === false){
        throw new RangeError(arguments.length > 2 ? templatedMessage(message, slice.call(arguments,2)) : message);
    }

    return expression;
};
},{}]},{},[7])
;
