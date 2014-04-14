'use strict';

var OnRamp = require('./onramp');

if (process.env.NODETIME) {
    require('nodetime').profile({
        accountKey: process.env.NODETIME,
        appName: 'swarming'
    });
}

var port = Number(process.env.PORT || 8080);

var app = require('./app');

var server = app.listen(port, function () {
    console.log('Express server listening on port ' + port);
});

var onramp = OnRamp.create({
    port: port,
    httpServer: server
});

app.initialize(onramp);
