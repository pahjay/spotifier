"use strict";

/**
 *  This file provides wrapper functions for managing the user mongodb collection.
 */
var Q = require('q'),
    User = new require('../models/user.js'),
    Artist = new require('../models/artist.js');

/**
 * @constructor
 */
var Db = function () {
    this._addIndex = 0;
};

/**
 * creates a new user document in the db
 * @param mUser: user object serialized in cookie {name, accessToken, refreshToken}
 * @returns {Q.Promise|Object} user doc from mongo
 */
Db.prototype.createUser = function (mUser) {
    var deferred = Q.defer(),
        username = mUser.name;
    User.findOne({'name': mUser.name}, function (err, user) {
        if (err) {
            console.log(err);
        }
        // check if exists
        if (user === null) {
            var user = new User({
                name: username
            }).save(function (err, user) {
                if (err) {
                    deferred.reject(err);
                }
                deferred.resolve(user);
            });
        } else {
            deferred.resolve(user);
        }
    });
    return deferred.promise;
};

/**
 * queries for user and returns user information
 * @param mUser: user object serialized in cookie {name, accessToken, refreshToken}
 * @returns: {Q.Promise|Object} user document information from mongodb
 */
Db.prototype.getUser = function (mUser) {
    var deferred = Q.defer();
    User.findOne({'name': mUser.name}, function (err, user) {
        if (user) {
            deferred.resolve(user);
        } else {
            deferred.reject('user not found in database...');
        }
    });
    return deferred.promise;
};

/**
 * queries for user information and adds all artists in array
 * @param mUser: user object serialized in cookie {name, accessToken, refreshToken}
 * @param artists: array of simple artist objects to retrieve detailed information and
 *                 add to db
 * @returns {Q.Promise}
 */
Db.prototype.addAllArtists = function (mUser, artists) {
    var db = this,
        i = this._addIndex,
        deferred = Q.defer();

    this.getUser(mUser)
        .then(function (user) {
            go(); // start recursive call

            function go() {
                // add artist
                db.addArtist(user, artists[i++])
                    .then(function () {
                        if (i < artists.length) {
                            setTimeout(go, 0);
                        } else {
                            deferred.resolve(); // end of artist array reached, resolve
                        }
                    })
                    .catch(function (err) {
                        deferred.reject(err); // add artist threw error, reject
                    });
            }
        })
        .catch(function (err) {
            // add user threw error, reject
            deferred.reject(err);
        });
    return deferred.promise;
};

/**
 * queries for user information and adds artist to user library
 * @param user: user object serialized in cookie {name, accessToken, refreshToken}
 * @param artist: simple artist object {spotifyId, name}
 * @returns {Q.Promise}
 */
Db.prototype.addArtist = function (user, artist) {
    var db = this;
    var deferred = Q.defer(),
        jobQueue = require('../utils/job-queue');

    // query for user
    // define query parameters
    var query = {'spotify_id': artist.spotify_id};
    // query for artist
    Artist.findOne(query, function (err, qArtist) {
        // if exists
        if (qArtist) {
            db.assignArtist(user, qArtist)
                .catch(function(err) {
                    deferred.reject(err);
                });
            deferred.resolve();
        } else {
            // if doesn't exist
            // create temporary artist document
            var update = {
                name: artist.name,
                spotify_id: artist.spotify_id,
                recent_release: {
                    title: 'recent release information pending from Spotify'
                }
            };
            // insert into database
            Artist.create(update, function (err, artist) {
                if (err) {
                    deferred.reject(err);
                } else {
                    // initialize a get details job
                    jobQueue.createGetArtistDetailsJob({artist: artist}, function (album) {
                        // assign album information once job has been processed
                        artist.recent_release = {
                            id: album.id,
                            title: album.name,
                            release_date: album.release_date,
                            images: album.images
                        };
                        // replace temporary artist values once details have been grabbed
                        artist.save();
                    });
                }
                // associate user and artist
                db.assignArtist(user, artist)
                    .catch(function(err) {
                        deferred.reject(err);
                    });
                deferred.resolve();

            })
        }
    });
    return deferred.promise;
};

/**
 * Associates an artist and a user by serializing their respective id's to their
 * database document, if they are valid.
 * @param user: mongodb user document, see models/user for schema information
 * @param artist: mongodb artist document, see models/artist for schema information
 * @returns {Q.Promise}
 */
Db.prototype.assignArtist = function (user, artist) {
    var deferred = Q.defer();
    // if artist has not already added user, push id to tracking list
    Artist.update({_id: artist._id}, {$addToSet: {users_tracking: user._id}}, function (err) {
        if (err) {
            deferred.reject(err);
        } else {
            // if user is not already tracking artist, push id to tracking list
            User.update({_id: user._id}, {$addToSet: {saved_artists: artist._id}}, function (err) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve();
                }
            });
        }
    });
    return deferred.promise;
};

/**
 * Disassociates an artist and a user in mongo. First we query for the user doc, then remove the user id
 * from the artist doc, and finally remove the artist id from the user doc.
 * @param user: mongodb document
 * @param artist: mongodb document
 * @returns {Q.Promise}
 */
Db.prototype.removeArtist = function (user, artist) {
    var deferred = Q.defer();
    // query for user information
    User.findOne({'name': user.name}, function (err, user) {
        // query for artist information, remove user objectId from tracking array
        Artist.findOneAndUpdate({'spotify_id': artist.spotify_id}, {$pull: {'users_tracking': user._id}},
            function (err, artist) {
                // remove artist ObjectId from user tracking array
                User.update({'_id': user._id}, {$pull: {'saved_artists': artist._id}},
                    function (err) {
                        if (err) {
                            deferred.reject(err);
                        } else {
                            deferred.resolve();
                        }
                    });
                if (err) {
                    deferred.reject(err);
                }
            })
    });
    return deferred.promise;
};

/**
 * retrieves the user's library from the db, if they exist
 * @param mUser: user object serialized in cookie {name, accessToken, refreshToken}
 * @returns: {Q.Promise|Array} Promise object with user library artist information
 */
Db.prototype.getLibrary = function (mUser) {
    var deferred = Q.defer();
    User.findOne({'name': mUser.name}, function (err, user) {
        if (err) {
            deferred.reject(err);
        }
        var artistIds = user.saved_artists;
        Artist.find({'_id': artistIds}, function (err, artists) {
            if (err) {
                deferred.reject(err);
            }
            deferred.resolve(artists);
        })
    });
    return deferred.promise;
};

/**
 * returns boolean whether user exists in mongodb
 * @param mUser: user object serialized in cookie {name, accessToken, refreshToken}
 * @returns: {Q.Promise|Boolean}
 */
Db.prototype.userExists = function (mUser) {
    var deferred = Q.defer();
    User.findOne({'username': mUser.name}, function (err, user) {
        if (err) {
            console.log(err);
        }
        deferred.resolve(user !== null);
    });
    return deferred.promise
};

/**
 * returns boolean based on whether the user has an email in the database
 * @param mUser: user object serialized in cooke {name, accessToken, refreshToken}
 * @returns: {Q.Promise|Boolean}
 */
Db.prototype.emailExists = function (mUser) {
    var deferred = Q.defer();
    User.findOne({'username': mUser}, function (err, user) {
        if (err) {
            console.log(err);
        }
        deferred.resolve(user !== null && user.email.address !== null);
    });
    return deferred.promise;
};

/**
 * returns boolean based on whether the user has confirmed their email in the database
 * @param mUser: user object serialized in cooke {name, accessToken, refreshToken}
 * @returns {Q.Promise|Boolean}
 */
Db.prototype.emailConfirmed = function (mUser) {
    var deferred = Q.defer();
    User.findOne({'username': mUser.name}, function (err, user) {
        if (err) {
            console.log(err);
        }
        deferred.resolve(user !== null && user.email.confirmed === true);
    });
    return deferred.promise;
};

module.exports = Db;