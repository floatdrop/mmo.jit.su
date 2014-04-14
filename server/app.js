'use strict';

var express = require('express');
var _ = require('lodash');

var app = express();
app.engine('hbs', require('hbs').__express);
app.set('view engine', 'hbs');
app.set('view options', { layout: false });
app.set('views', __dirname + '/../public');
app.use(express.static(__dirname + '/../public'));

app.initialize = function (onramp) {
    var _db;

    if (process.env.MONGO_CS) {
        var MongoClient = require('mongodb').MongoClient;
        MongoClient.connect(process.env.MONGO_CS, function (err, db) {
            if (err) { throw err; }
            _db = db;
        });
    }

    onramp.on('connection', function (connection) {
        console.log('>>> ' + connection.address + ' connected');
        onramp.connections.forEach(function (other) {
            if (other === connection) { return; }
            connection.send(other.address);
            other.send(connection.address);
            if (_db) {
                _db.collection('network').insert({ date: new Date(), p1: connection.address, p2: other.address, state: 'connected' }, function (err) {
                    if (err) { console.log(err); }
                });
            }
        });
    });

    onramp.on('disconnect', function (connection) {
        console.log('<<< ' + connection.address + ' disconnected');
        if (_db) {
            _db.collection('logs').insert({ date: new Date(), p1: connection.address, state: 'disconnected' }, function () { });
        }
    });

};

module.exports = app;
