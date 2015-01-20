var should = require( 'should' ); //jshint ignore:line
var _ = require( 'lodash' );
var when = require( 'when' );
var seq = require( 'when/sequence' );
var fs = require( 'fs' );
var requestor = require( 'request' ).defaults( { jar: false } );
var postal = require( 'postal' );
var events = postal.channel( 'events' );
var port = 88981;
var config = {
	port: port,
	socketio: true,
	websocket: true,
	defaultUser: true,
	anonymous: [ '/api/test/proxy' ],
	parseAhead: true,
	handleRouteErrors: true
};

describe( 'Websocket', function() {
	var cookieExpiresAt;
	var harness;
	// * proxy action that allows an anon user to access an authenticated endpoint
	// * action that returns a file to an authenticated user
	// * action to capture various information from the incoming request and return it to the caller
	// * action to redirect to a different resource
	// * action that throws exception
	// * action with a regex URL
	// * route that throws an exception
	before( function() {
		harness = require( './harness.js' )( config );
		cookieExpiresAt = new Date( Date.now() + 60000 );
		var argsCall = function( env ) {
			env.reply( {
				data: [ env.data.one, env.data.two, env.data.three, env.data.four, env.params.three, env.params.four, env.extension, env.preparsed ],
				headers: { 'test-header': 'look a header value!' },
				cookies: { 'an-cookies': {
						value: 'chocolate chip',
						options: {
							expires: cookieExpiresAt,
							path: '/api',
							domain: 'autohost.com'
						}
					} }
			} );
		};

		var anonProxy = function( env ) {
			if ( env.transport === 'http' ) {
				var url = 'http://localhost:88981' + env.url.replace( 'proxy', 'args' );
				env.forwardTo( {
					headers: { 'Authorization': 'Bearer one' },
					url: url
				} );
			} else {
				env.reply( { data: 'This call is not supported over websockets' } );
			}
		};

		var errorCall = function( env ) {
			throw new Error( 'I am bad at things!' );
		};

		var fileCall = function( env ) {
			env.replyWithFile( 'text/plain', 'hello.txt', fs.createReadStream( './spec/public/txt/hello.txt' ) );
		};

		var redirectCall = function( env ) {
			var data = { id: env.data.id };
			if ( env.data.id == '100' ) {
				env.redirect( '/api/test/thing/200' );
			} else if ( env.data.id == '101' ) {
				env.redirect( 301, '/api/test/thing/201' );
			} else {
				env.reply( { data: data } );
			}
		};

		var regexUrl = function( env ) {
			env.reply( { data: 'regex route matched' } );
		};

		harness.addMiddleware( '/', function( req, res, next ) {
			req.extendHttp = {
				extension: 'an extension!',
				preparsed: req.preparams
			};
			next();
		} );

		harness.addResource( {
			name: 'test',
			actions: {
				args: { url: '/args/:one/:two/:three', method: 'post', topic: 'args', handle: argsCall },
				error: { url: '/error', method: 'get', topic: 'error', handle: errorCall },
				file: { url: '/file', method: 'get', topic: 'file', handle: fileCall },
				proxy: { url: '/proxy/:one/:two/:three', method: 'post', topic: 'proxy', handle: anonProxy },
				regex: { url: /test\/regex.*/, method: 'all', handle: regexUrl },
				thing: { url: '/thing/:id', method: 'get', topic: 'thing', handle: redirectCall }
			}
		} );

		harness.addResource( {
			name: 'testWithStatic',
			static: './spec/public/'
		} );

		harness.addRoute( '/api/test/fail', 'GET', errorCall );
		harness.addTopic( 'fail', errorCall );
		harness.setActionRoles( 'test.args', [ 'user' ] );
		harness.addUser( 'usertwo', 'two', 'two', [] );
		harness.addUser( 'usererror', 'three', 'three', [] );
		harness.addUser( 'usernoperm', 'four', 'four', [] );
		harness.start();
	} );

	describe( 'Sending args message (authenticated & authorized)', function() {
		var response, ws;
		before( function( done ) {
			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer one' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'test.args' ) {
						response = json.data;
						done();
					}
				} );

				socket.sendUTF( JSON.stringify( {
					topic: 'test.args',
					data: {
						one: 'alpha',
						two: 'bravo',
						three: 'charlie',
						four: 'foxtrot'
					}
				} ) );
			} );
		} );

		it( 'should preserve overlapping values', function() {
			response.should.eql( { data: [ 'alpha', 'bravo', 'charlie', 'foxtrot', null, null, null, null ], _headers: { 'test-header': 'look a header value!' } } );
		} );
	} );

	describe( 'Sending args message (unauthenticated)', function() {
		var ws;
		before( function( done ) {

			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer none' } );
			ws.once( 'connectFailed', function() {
				done();
			} );
		} );

		it( 'should reject user as unauthenticated', function() {} );
	} );

	describe( 'Sending args message (unauthorized)', function() {
		var response, ws;
		before( function( done ) {
			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer two' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'test.args' ) {
						response = json.data;
						done();
					}
				} );

				socket.sendUTF( JSON.stringify( {
					topic: 'test.args',
					data: {
						one: 'alpha',
						two: 'bravo',
						three: 'charlie',
						four: 'foxtrot'
					}
				} ) );
			} );
		} );

		it( 'should reject user as unauthorized', function() {
			response.should.eql( 'User lacks sufficient permissions' );
		} );
	} );

	describe( 'Sending args message (exception on role check)', function() {
		var response, ws;
		before( function( done ) {
			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer three' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'test.args' ) {
						response = json.data;
						done();
					}
				} );

				socket.sendUTF( JSON.stringify( {
					topic: 'test.args',
					data: {
						one: 'alpha',
						two: 'bravo',
						three: 'charlie',
						four: 'foxtrot'
					}
				} ) );
			} );
		} );

		it( 'should reject user as unauthorized', function() {
			response.should.eql( 'User lacks sufficient permissions' );
		} );
	} );

	describe( 'Sending args message (exception on checkPermissions)', function() {
		var response, ws;
		before( function( done ) {
			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer four' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'test.args' ) {
						response = json.data;
						done();
					}
				} );

				socket.sendUTF( JSON.stringify( {
					topic: 'test.args',
					data: {
						one: 'alpha',
						two: 'bravo',
						three: 'charlie',
						four: 'foxtrot'
					}
				} ) );
			} );
		} );

		it( 'should reject user as unauthorized', function() {
			response.should.eql( 'User lacks sufficient permissions' );
		} );
	} );

	describe( 'Requesting temporarily moved resource', function() {
		var response, ws;
		before( function( done ) {
			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer one' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'test.thing' && !response ) {
						response = json.data;
						done();
					}
				} );

				socket.sendUTF( JSON.stringify( {
					topic: 'test.thing',
					data: {
						id: 100
					}
				} ) );
			} );
		} );

		it( 'should return the redirected item', function() {
			response.should.eql( 'The resource you are trying to reach has moved.' );
		} );
	} );

	describe( 'Making a request to a broken action', function() {
		var response, ws;
		before( function( done ) {
			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer one' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'test.error' && !response ) {
						response = json.data;
						done();
					}
				} );

				socket.sendUTF( JSON.stringify( {
					topic: 'test.error',
					data: {
						id: 100
					}
				} ) );
			} );
		} );

		it( 'should return error message', function() {
			response.should.eql( 'Server error at topic test.error' );
		} );
	} );

	describe( 'Making a request to a broken topic', function() {
		var response, ws;
		before( function( done ) {
			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer one' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'fail' && !response ) {
						response = json.data;
						done();
					}
				} );

				socket.sendUTF( JSON.stringify( {
					topic: 'fail',
					data: {
						id: 100
					}
				} ) );
			} );
		} );

		it( 'should return error message', function() {
			response.should.eql( 'Server error at topic fail' );
		} );
	} );

	describe( 'Accessing static files from a resource static path', function() {
		var response = {
			buffers: [],
			total: 0
		};
		var ws, onMessage;
		before( function( done ) {
			onMessage = function( msg ) {
				if ( msg.start ) {
					response.metadata = msg;
				} else if ( msg.data ) {
					response.buffers.push( new Buffer( msg.data ) );
					response.total += msg.data.length;
				}
				if ( msg.end ) {
					response.bytes = Buffer.concat( response.buffers, response.total );
					done();
				}
			};

			ws = harness.getWSClient( 'http://localhost:88981/websocket', { Authorization: 'Bearer one' } );
			ws.once( 'connect', function( socket ) {
				socket.on( 'message', function( msg ) {
					var json = JSON.parse( msg.utf8Data );
					if ( json.topic === 'test.file' ) {
						onMessage( json.data );
					}
				} );
				socket.sendUTF( JSON.stringify( {
					topic: 'test.file',
					data: {
						id: 100
					}
				} ) );
			} );
		} );

		it( 'should return the file', function() {
			response.bytes.toString().should.eql( 'hello, world!' );
		} );

		after( function() {
			ws.removeListener( 'message', onMessage );
		} );
	} );

	describe( 'Without users', function() {

		before( function() {
			harness.clearUsers();
		} );

		describe( 'Sending args message without adequate permissions', function() {
			var response, ws;
			before( function( done ) {
				ws = harness.getWSClient( 'http://localhost:88981/websocket', {} );
				ws.once( 'connect', function( socket ) {
					socket.on( 'message', function( msg ) {
						var json = JSON.parse( msg.utf8Data );
						if ( json.topic === 'test.args' ) {
							response = json.data;
							done();
						}
					} );

					socket.sendUTF( JSON.stringify( {
						topic: 'test.args',
						data: {
							one: 'alpha',
							two: 'bravo',
							three: 'charlie',
							four: 'foxtrot'
						}
					} ) );
				} );
			} );

			it( 'should reject user as unauthorized', function() {
				response.should.eql( 'User lacks sufficient permissions' );
			} );
		} );

		describe( 'Sending args message with adequate permissions', function() {
			var response, ws;
			before( function( done ) {
				harness.setActionRoles( 'test.args', [] );
				ws = harness.getWSClient( 'http://localhost:88981/websocket', {} );
				ws.once( 'connect', function( socket ) {
					socket.on( 'message', function( msg ) {
						var json = JSON.parse( msg.utf8Data );
						if ( json.topic === 'test.args' ) {
							response = json.data;
							done();
						}
					} );

					socket.sendUTF( JSON.stringify( {
						topic: 'test.args',
						data: {
							one: 'alpha',
							two: 'bravo',
							three: 'charlie',
							four: 'foxtrot'
						}
					} ) );
				} );
			} );

			it( 'should preserve overlapping values', function() {
				response.should.eql( { data: [ 'alpha', 'bravo', 'charlie', 'foxtrot', null, null, null, null ], _headers: { 'test-header': 'look a header value!' } } );
			} );
		} );
	} );

	after( function() {
		harness.stop();
	} );
} );
