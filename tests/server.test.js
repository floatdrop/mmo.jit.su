/* global describe, it */

'use strict';

var request = require('supertest');
var app = require('../server/app.js');

describe('Swarming server', function () {
    it('should return index page', function (done) {
        request(app)
            .get('/')
            .expect(200)
            .end(done);
    });
});
