/* Seng 480A/CSC586A
 * Assignment 1 Part 3
 *
 * Find your friends API server
 *
 * */

var restify         = require('restify'),
    q               = require('q'),
    bunyan          = require('bunyan'),
    fs              = require('fs'),
    _               = require('underscore'),
    pg              = require('pg'),
    appName         = "fyf-api",
    appVersion      = "0.7.0",
    serverPort      = (process.env.PORT || 8080);

var log = bunyan.createLogger({
    name: appName,
    serializers: {
        req: requestSerializer, //bunyan.stdSerializers.req,
        res: restify.bunyan.serializers.res
    },
    streams: [
        {
            level: 'info',
            stream: process.stdout
        },
        // FIXME: this logging to a file is not working with heroku, so disabling it for now
        /*{
            level: 'info',
            path: './log/server.log',
            type: 'file'
        }*/
    ]
});

function requestSerializer(request) {
    return {
        method: request.method,
        url: request.url
        //headers: request.headers,
    }
}

function responseSerializer(response) {
    if (!response || !response.statusCode)
        return (response);

    return ({
        statusCode: response.statusCode,
        headers: response.headers,
        parameters: response.parameters
    });
}

var server = restify.createServer(
    {
        name: appName,
        version: appVersion,
        log: log,
        formatters: {
//                'application/json': function(req, res, body){
//                    if(req.params.callback){
//                        var callbackFunctionName = req.params.callback.replace(/[^A-Za-z0-9_\.]/g, '');
//                        return callbackFunctionName + "(" + JSON.stringify(body) + ");";
//                    } else {
//                        return JSON.stringify(body);
//                    }
//                },
            'text/html': function(request, response, body){
                return JSON.stringify(body);
            }
        }
    }
);

server.on('error', function(error) {
    if (error.errno == 'EADDRINUSE') {
        log.error('%s failed to bind port %s', server.name, serverPort);
        console.log('%s failed to bind port %s', server.name, serverPort);
    } else {
        log.error('%s received unexpected error %s', server.name, error);
        console.log('%s received unexpected error %s', server.name, error);
    }
});

server.listen(serverPort, function (err) {
    console.log('%s listening at %s', server.name, server.url);
    log.info('%s listening at %s', server.name, server.url);
});

server.pre(restify.pre.userAgentConnection())
    .pre(restify.pre.sanitizePath())
    .use(restify.CORS())
    .use(restify.fullResponse())
    .use(restify.acceptParser(server.acceptable))
    .use(restify.queryParser())
    .use(restify.bodyParser({mapParams: false}))
    .use(restify.jsonp());

/*
 * server routing
 *
 */

/* log a message upon completion of the request */
//server.on('after', function (request, response, route) {
//    request.log.info({res: response}, "finished");
//});

/* install a request logger for all requests. */
server.pre(function (request, response, next) {
    request.log.info({ req: request }, 'REQUEST');
    next();
});

server.get('/hello', hello);
server.get('/getLocations', getLocations);
server.post('/addLocation', addLocation);

/*
 * end of server routing
 *
 */


/*
 * route handler functions
 *
 */
function hello(request, response, next) {
    request.log.info({ req: request, requestParameters: request.params});
    var result = {"hello": "test"};
    response.contentType = 'application/json';
    response.send(result);

    return next();
}

function getLocations(request, response, next) {
    pgQuery('SELECT * FROM locations')
        .then(
            function success(results) {
                response.contentType = 'json';
                response.send(results.rows)
            },
            function failure(err) {
                var error = new restify.errors.InternalError(err);
                response.contentType = 'json';
                response.send(error);
                log.error(error);
            }
        );

    return next();
}

function addLocation(request, response, next) {
    request.log.info({ req: request, requestParameters: request.body});
    var data;
    /*
     * Location Attributes
     * • coordinate Property
     *    latitude:     The latitude in degrees. Positive values indicate latitudes north of the equator. Negative values indicate latitudes south of the equator.
     *    longitude:     The longitude in degrees. Measurements are relative to the zero meridian, with positive values extending east of the meridian and negative values extending west of the meridian.
     * • altitude Property
     * • horizontalAccuracy Property
     * • verticalAccuracy Property
     */
    try {
        data = {
            client: request.body.client || parameterMissingError('client'),
            latitude: request.body.latitude || parameterMissingError('latitude'),
            longitude: request.body.longitude || parameterMissingError('longitude'),
            altitude: request.body.altitude || parameterMissingError('altitude'),
            horizontalAccuracy: request.body.horizontalAccuracy || parameterMissingError('horizontalAccuracy'),
            verticalAccuracy: request.body.verticalAccuracy || parameterMissingError('verticalAccuracy'),
            time: new Date().toISOString()
        };

        pgQuery(
                "INSERT INTO locations (client, latitude, longitude, altitude, horizontalAccuracy, verticalAccuracy, time) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [data.client, data.latitude, data.longitude, data.altitude, data.horizontalAccuracy, data.verticalAccuracy, data.time]
            )
            .then(
                function success(results) {
                    response.contentType = 'json';
                    response.send(200, {msg: 'addition ok'});
                },
                function failure(err) {
                    var error = new restify.errors.InternalError(err);
                    response.contentType = 'json';
                    response.send(error);
                    log.error(error);
                }
            );
    } catch (e) {
        var error = new restify.errors.BadRequestError('error: ' + e.toString());
        response.contentType = 'json';
        response.send(error);
        log.error(error);
    }
    return next();
}

/*
 * end of route handlers
 *
 */

/*
 * Postgresql access functions
 *
 */
function pgQuery(query, values) {
    var deferred = q.defer();

    pg.connect(process.env.DATABASE_URL, function (err, client, done) {
        if (err) {
            deferred.reject(err);
        }
        if (values) {
            client.query(query, values, function handleDBResponse(err, result) {
                done(); // calling done() releases the client back into the client pool.
                if (err) {
                    log.error(err);
                    deferred.reject(err);
                } else {
                    deferred.resolve(result);
                }
            });
        } else {
            client.query(query, function handleDBResponse(err, result) {
                done(); // calling done() releases the client back into the client pool.
                if (err) {
                    log.error(err);
                    deferred.reject(err);
                } else {
                    deferred.resolve(result);
                }
            });
        }

    });
    return deferred.promise;
}

/*
 * End of Postgresql access functions
 *
 */

/*
 * Miscellaneous functions
 *
 */
function parameterMissingError(parameter) {
    throw new MissingParameterException(parameter);
}

function MissingParameterException(value) {
    this.value = value;
    this.name = 'MissingParameter';
    this.message = "request is missing parameter";
    this.toString = function() {
        return this.name + ': ' + this.message  + ': ' + this.value;
    };
}
