var should = require( 'should' );  //jshint ignore:line
var requestor = require( 'request' ).defaults( { jar: true } );
var metrics = require( 'cluster-metrics' );
var port = 88988;
var config = {
	port: port,
	anonymous: [ '/api/forward' ]
};
var authProvider = require( './auth/mock.js' )( config );
var passport = require( '../src/http/passport.js' )( config, authProvider, metrics );
var middleware = require( '../src/http/middleware.js' )( config, metrics );
var http = require( '../src/http/http.js' )( config, requestor, passport, middleware, metrics );
var httpAdapterFn = require( '../src/http/adapter.js' );
var actionRoles = function( action, roles ) {
		authProvider.actions[ action ] = { roles: roles };
	};
var userRoles = function( user, roles ) {
		authProvider.users[ user ].roles = roles;
	};

describe( 'with http adapter and api prefix', function() {
	var httpAdapter;

	var cleanup = function() {
			userRoles( 'userman', [] );
			actionRoles( 'test.call', [] );
			actionRoles( 'test.forward', [] );
			actionRoles( 'test.echo', [] );
			actionRoles( 'test.regex', [] );
		};

	before( function() {
		httpAdapter = httpAdapterFn( config, authProvider, http, requestor, metrics );
		authProvider.tokens = { 'blorp': 'userman' };
		authProvider.users = { 'userman': { name: 'userman', password: 'hi', roles: [] } };
		httpAdapter.action( { name: 'test' }, 'call', {
			method: 'get',
			url: '/test/call/:one/:two',
			handle: function( env ) {
				env.reply( { data: 'ta-da!' } );
			}
		}, { routes: {} } );
		httpAdapter.action( { name: 'test' }, 'forward', {
			method: 'get',
			url: '/test/forward/:one/:two',
			handle: function( env ) {
				env.forwardTo( {
					url: 'http://userman:herp@localhost:88988/api/test/call/10/20'
				} );
			}
		}, { routes: {} } );
		httpAdapter.action( { name: 'test' }, 'echo', {
			method: 'get',
			url: /.*\/echo/,
			handle: function( env ) {
				env.reply( { data: 'echo-echo-echo-echo-echo-o-o-o-o-o-o-oooooo' } );
			}
		}, { routes: {} } );
		httpAdapter.action( { name: 'test' }, 'regex', {
			method: 'get',
			url: /^\/views\//,
			handle: function( env ) {
				env.reply( { data: 'SWEET' } );
			}
		}, { routes: {} } );
		http.start();
	} );

	describe( 'when making a request with inadequate permissions', function() {
		var result;

		before( function( done ) {
			actionRoles( 'test.call', [ 'admin' ] );
			userRoles( 'userman', [ 'guest' ] );
			requestor.get( {
				url: 'http://userman:hi@localhost:88988/api/test/call/10/20'
			}, function( err, resp ) {
				result = resp;
				done();
			} );
		} );

		it( 'should tell user to take a hike', function() {
			result.body.should.equal( 'User lacks sufficient permissions' );
		} );

		it( 'should return 403', function() {
			result.statusCode.should.equal( 403 );
		} );

		after( cleanup );
	} );

	describe( 'when making a request with adequate permissions', function() {
		var result;

		before( function( done ) {
			actionRoles( 'test.call', [ 'guest' ] );
			userRoles( 'userman', [ 'guest' ] );
			requestor.get( {
				url: 'http://localhost:88988/api/test/call/10/20',
				headers: {
					'Authorization': 'Bearer blorp'
				}
			}, function( err, resp ) {
				result = new Buffer( resp.body, 'utf-8' ).toString();
				done();
			} );
		} );

		it( 'should return action response', function() {
			result.should.equal( 'ta-da!' );
		} );

		after( cleanup );
	} );

	describe( 'when making a request to a pattern route with adequate permissions', function() {
		var result;

		before( function( done ) {
			actionRoles( 'test.call', [ 'guest' ] );
			userRoles( 'userman', [ 'guest' ] );
			requestor.get( {
				url: 'http://localhost:88988/api/test/echo/10/20',
				headers: {
					'Authorization': 'Bearer blorp'
				}
			}, function( err, resp ) {
				result = new Buffer( resp.body, 'utf-8' ).toString();
				done();
			} );
		} );

		it( 'should return action response', function() {
			result.should.equal( 'echo-echo-echo-echo-echo-o-o-o-o-o-o-oooooo' );
		} );

		after( cleanup );
	} );

	describe( 'when forwarding a request from an anonymous endpoint', function() {
		var result;

		before( function( done ) {
			actionRoles( 'test.call', [ 'guest' ] );
			userRoles( 'userman', [ 'guest' ] );
			requestor.get( {
				url: 'http://localhost:88988/api/test/forward/10/20'
			}, function( err, resp ) {
				result = new Buffer( resp.body, 'utf-8' ).toString();
				done();
			} );
		} );

		it( 'should return action response', function() {
			result.should.equal( 'ta-da!' );
		} );

		after( cleanup );
	} );

	after( http.stop );
} );

describe( 'with http adapter and no api prefix', function() {
	var httpAdapter;
	var cleanup = function() {
			userRoles( 'userman', [] );
			actionRoles( 'test.call', [] );
			actionRoles( 'test.forward', [] );
			actionRoles( 'test.echo', [] );
			actionRoles( 'test.regex', [] );
		};

	before( function() {
		config.apiPrefix = '';
		httpAdapter = httpAdapterFn( config, authProvider, http, requestor, metrics );
		authProvider.tokens = { 'blorp': 'userman' };
		authProvider.users = { 'userman': { name: 'userman', password: 'hi', roles: [] } };
		httpAdapter.action( { name: 'test' }, 'regex', {
			method: 'get',
			url: /^\/views\//,
			handle: function( env ) {
				env.reply( { data: 'SWEET' } );
			}
		}, { routes: {} } );
		http.start();
	} );

	describe( 'when making a request to a pattern route with adequate permissions', function() {
		var result;

		before( function( done ) {
			actionRoles( 'test.regex', [ 'guest' ] );
			userRoles( 'userman', [ 'guest' ] );
			requestor.get( {
				url: 'http://localhost:88988/views/this/is/the/greatest/url/ever',
				headers: {
					'Authorization': 'Bearer blorp'
				}
			}, function( err, resp ) {
				result = new Buffer( resp.body, 'utf-8' ).toString();
				done();
			} );
		} );

		it( 'should return action response', function() {
			result.should.equal( 'SWEET' );
		} );

		after( cleanup );
	} );

	after( http.stop );
} );