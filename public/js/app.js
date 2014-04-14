/* global $, P */

$(function () {
    'use strict';

    var p = P.create();
    var onrampServerAddress = 'ws://' + (location.hostname) + ':' + (window.location.hostname === 'localhost' ? 8080 : 80) + '/';
    var onramp = p.connect(onrampServerAddress);

    onramp.on('open', function () {
        console.log('OPEN');
        createPlayer();
    });

    function bindPeer(peer) {
        var id = peer.address;
        peer.on('message', function (data) {
            if (!data.type) { return console.log('Malformed message from ' + id); }
            if (data.type === 'POSITION') {
                $('#' + id).offset({left: data.left, top: data.top});
            }
        });
    }

    onramp.on('message', function (peerAddress) {
        var peer = onramp.connect({ address: peerAddress, offerData: 'Hi!' });
        peer.on('open', function () {
            bindPeer(peer);
            sendPosition(peer);
        });
    });

    onramp.on('connection', function (peer) {
        var id = peer.address;
        $('#' + id).remove();
        $('#cursors').append('<div class="cursor" id="' + id + '"></div>');
        $('#users span').text($('#cursors div:visible').length);
        console.log('CONNECTION from ' + id);
        peer.on('open', function () {
            bindPeer(peer);
        });
    });

    onramp.on('disconnection', function (peer) {
        console.log('DISCONNECTED', peer);
        $('#' + peer.address).remove();
        $('#users span').text($('#cursors div:visible').length);
    });

    function sendPosition(peer, offset) {
        offset = offset || $('#player').offset();
        peer.send({type: 'POSITION', left: offset.left, top: offset.top});
    }

    function createPlayer() {
        $('#cursors').append('<div class="cursor" id="player"></div>');
        $('#player').css('opacity', '0.1');
        $('#cursors').mousemove($.throttle(50, function (event) {
            $('#player').offset({left: event.pageX, top: event.pageY});
            onramp.getPeers().forEach(function (peer) {
                sendPosition(peer, {left: event.pageX, top: event.pageY});
            });
        }));
    }
});
