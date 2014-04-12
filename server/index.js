'use strict';

var PeerServer = require('./peer').PeerServer;

if (process.env.NODETIME) {
    require('nodetime').profile({
        accountKey: process.env.NODETIME,
        appName: 'swarming'
    });
}

var port = Number(process.env.PORT || 8080),
    url  = 'http://localhost:' + port + '/';

if (process.env.SUBDOMAIN) {
    url = 'http://' + process.env.SUBDOMAIN + '.jit.su/';
}

var app = require('./app');

var server = app.listen(port, function () {
    console.log('Express server listening on port ' + port);
});

var peerServer = new PeerServer({
    path: '/api/',
    server: server
});

app.use(peerServer);

app.initialize(peerServer);
