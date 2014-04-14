/* global $, Peer */

$(function () {
    'use strict';

    var connections = {};

    var peer = new Peer({
        host: '/',
        port: window.location.hostname === 'localhost' ? 8080 : 80,
        path: '/api/',
        config: { 'iceServers': Config }
    });

    peer.on('open', function (id) {
        createPlayer(id);
        createConnections();
    });

    peer.on('error', function (err) {
        console.log('ERROR', err);
    });

    peer.on('connection', function (conn) {
        var self = this;
        var id = conn.peer;
        $('#' + id).remove();
        $('#cursors').append('<div class="cursor" id="' + id + '"></div>');
        $('#users span').text($('#cursors div:visible').length);
        console.log('CONNECTION from ' + id);
        conn.on('data', function (data) {
            if (!data.type) { return console.log('Malformed message from ' + id); }
            if (data.type === 'LATENCY') {
                peer.trace({
                    latency: (new Date()).getTime() - data.sended,
                    p1: self.id,
                    p2: id
                });
            }
            if (data.type === 'GREETINGS') {
                console.log('GREETINGS from ' + id);
                var recieved = (new Date()).getTime();
                getConnection(id, function (c) {
                    c.send({
                        type: 'LATENCY',
                        recieved: recieved,
                        sended: data.sended
                    });
                });
            }
            if (data.type === 'POSITION') {
                $('#' + id).offset({left: data.left, top: data.top});
            }
        });
        conn.on('close', function () {
            console.log('CLOSED ' + id);
            $('#' + id).remove();
            $('#users span').text($('#cursors div:visible').length);
        });
    });

    function greetings(id) {
        var data = {
            type: 'GREETINGS',
            sended: (new Date()).getTime()
        };
        getConnection(id, function (c) { c.send(data); });
    }

    function createConnections() {
        $('#cursors div').each(function () {
            var id = $(this).attr('id');
            getConnection(id, function () {
                $('#' + id).show();
                greetings(id);
            });
        });
    }

    function getConnection(id, cb) {
        cb = cb || function () {};
        if (connections[id]) { return cb(connections[id]); }

        var conn = peer.connect(id);
        if (!conn) { return console.log('!!! Failed to fetch connection for ' + id); }
        connections[id] = conn;
        conn.on('open', cb.bind(cb, conn));
        conn.on('error', function (err) {
            console.log('connection is dead ', err);
            delete connections[id];
        });
    }

    function createPlayer(id) {
        $('#cursors').append('<div class="cursor" id="' + id + '"></div>');
        var player = $('#' + id);
        player.css('opacity', '0.1');
        $('#cursors').mousemove($.throttle(50, function (event) {
            player.offset({left: event.pageX, top: event.pageY});
            for (var id in connections) {
                getConnection(id, function (c) {
                    c.send({type: 'POSITION', left: event.pageX, top: event.pageY});
                    //greetings(id);
                });
            }
        }));


    }
});
