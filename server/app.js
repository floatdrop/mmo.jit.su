'use strict';

var express = require('express');
var _ = require('lodash');

var app = express();
app.engine('hbs', require('hbs').__express);
app.set('view engine', 'hbs');
app.set('view options', { layout: false });
app.set('views', __dirname + '/../public');
app.use(express.static(__dirname + '/../public'));

app.initialize = function (peerServer) {
    var _db;

    app.get('/', function (req, res) {
        var users = [];
        _.each(peerServer._clients.peerjs, function (client, id) { users.push(id); });
        res.render('index.hbs', {
            users: users,
            count: users.length
        });
    });

    if (process.env.MONGO_CS) {
        var MongoClient = require('mongodb').MongoClient;
        MongoClient.connect(process.env.MONGO_CS, function (err, db) {
            if (err) { throw err; }
            _db = db;
        });
    }

    peerServer.on('trace', function (data) {
        if (_db) {
            data.payload.date = Date();
            _db.collection('latency').insert(data.payload, function (err) {
                if (err) { console.log(err); }
                console.log(data.payload.p1 + ' --- ' + data.payload.latency + ' --> ' + data.payload.p2);
            });
        }
    });

    peerServer.on('connection', function (id) {
        console.log('>>> ' + id + ' connected');
        if (_db) { _db.collection('logs').insert({user: id, action: 'connected'}, function () { }); }
    });

    peerServer.on('disconnect', function (id) {
        console.log('<<< ' + id + ' disconnected');
        if (_db) { _db.collection('logs').insert({user: id, action: 'disconnected'}, function () { }); }
    });

};

module.exports = app;
