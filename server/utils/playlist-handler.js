/**
 * This utility handles creating spotifier playlists for users with new releases.
 */
const Q = require('q');
const fs = require('fs');
const path = require('path');
const User = require('../models/user');
const Db = require('../utils/db');
const SpotifyUserApi = require('./spotify-user-api');

/**
 * Iterates through all users who have new releases found and update playlists.
 * TODO:
 *  - add playlist creation enabled query condition once the settings page has
 *    been created and the schema has updated.
 */
var updateNewReleasePlaylists = function () {
    var self = this;
    var promises = [];
    var deferred = Q.defer();
    var p = Q();

    User.find({
            $and: [{ // query filter
                    'new_releases': {
                        $exists: true,
                        $ne: []
                    }
                },
                {
                    'refresh_token': {
                        $exists: true
                    }
                }
            ]
        },
        function (err, users) {
            if (err) {
                throw new Error(err);
            }
            console.log('Users length: ' + users.length);

            users.forEach(function (user) {
                p = p.then(function () {
                    return updatePlaylist(user)
                })
                .catch(function(err) {
                   // console.log(user);
                   console.log('playlist-handler.js updateNewReleasePlaylists: ' + err); 
                });
            });
            deferred.resolve(p);

            // for (var i = 0; i < users.length; i++) {
            //     console.log(i);
            //     promises.push(updatePlaylist(users[i]));
            // }
            // deferred.resolve(Q.allSettled(promises));
        });
    return deferred.promise;
}


/**
 * Query for user by _id, parse all artist ids in new_release field, check if
 * a user's spotifier playlist exists, clear the user's spotifier playlist,
 * add the release to the user's playlist.
 * TODO:
 * check if user has turned on playlist creation
 * @param user mongo doc for user
 */
function updatePlaylist(user) {
    var deferred = Q.defer();
    var api = new SpotifyUserApi();

    playlistExists(user)
        .then(function (exists) {
            if (!exists) {
                return createPlaylist(user);
            } else {
                return;
            }
        })
        .then(function () {
            // is current date later than reset date?
            return playlistResetNeeded(user);
        })
        .then(function (reset) {
            // if reset, empty playlist
            if (reset) {
                console.log('playlist reset needed for ' + user.name + '. Emptying...');
                return api.emptyPlaylist(user);
            } else {
                console.log('playlist reset not needed for ' + user.name);
                return;
            }
        })
        .then(function () {
            console.log('adding releases to playlist');
            // console.log(user);
            // add releases
            api.addReleaseTracksToPlaylist(user)
                .then(function () {
                    console.log('finished adding releases');
                    console.log('----------------------------------------------');
                    console.log('PASS CASE');
                    console.log(user);
                    console.log('----------------------------------------------');
                    console.log('pausing for api');
                    setTimeout(function() {
                        deferred.resolve();
                    }, 500);
                    
                })
                .catch(function (err) {
                    console.log('ERROR: addReleaseTracksToPlaylist');
                    console.log(err);
                    console.log('----------------------------------------------');
                    console.log('FAIL CASE')
                    console.log(user);
                    console.log('----------------------------------------------');
                    deferred.reject(err);
                });
        })
        .catch(function (err) {
            deferred.reject(err);
        })
    return deferred.promise;
}

/**
 * Calls user api module to determine whether a valid spotify api exists.
 * @param {JSON} user mongodb user document
 * @returns {Promise<Boolean>} promise object with boolean value 
 */
function playlistExists(user) {
    var deferred = Q.defer();
    var api = new SpotifyUserApi();
    api.playlistExists(user)
        .then(function (exists) {
            deferred.resolve(exists);
        })
        .catch(function (err) {
            deferred.reject(err);
        });
    return deferred.promise;
}

/**
 * We we into the next playlist week? Playlists reset on 11:59AM Saturday evening.
 * @returns {Boolean} new playlist week?
 */
function playlistResetNeeded(user) {

    var deferred = Q.defer();
    var globalResetDate = getPlaylistResetDate(); // last global reset
    var userResetDate = user.playlist.last_reset; // user's last reset
    var currentDateTime = new Date(); // current date

    if (!userResetDate) { // if first rese, serialize date and skip for user
        serializeUserResetDate(user)
            .then(function () {
                deferred.resolve(false); // skip this weeks reset
            })
            .catch(function (err) {
                console.log(err);
            });
    } else {
        userResetDate = new Date(userResetDate); // instantiate for comparator
        var diffOfDays = numDaysBetween(userResetDate, globalResetDate);
        // console.log('difference of days: ' + diffOfDays);
        console.log(globalResetDate + ' ' + currentDateTime);

        if (diffOfDays >= 7 && globalResetDate < currentDateTime) {
            serializeUserResetDate(user)
                .then(function () {
                    deferred.resolve(true);
                })
                .catch(function (err) {
                    console.log(err);
                })
        } else {
            deferred.resolve(false);
        }
    }
    return deferred.promise;
}

/**
 * How many days are between the two dates?
 * Solution found @ https://stackoverflow.com/questions/6154689/how-to-check-if-date-is-within-30-days
 * @param {Date} d1 
 * @param {Date} d2 
 */
var numDaysBetween = function (d1, d2) {
    var diff = Math.abs(d1.getTime() - d2.getTime());
    return Math.floor(diff / (1000 * 60 * 60 * 24));
};

/**
 * Serialize the last playlist date into database for user
 * @param {JSON} user mongodb user document
 * @param {string} newDate new date value to be serialized
 */
function serializeUserResetDate(user) {
    var deferred = Q.defer();
    var currentDateTime = new Date();
    User.update({
        '_id': user._id
    }, {
        'last_reset': currentDateTime
    }, function (err) {
        if (err) {
            deferred.reject(err);
        }
        deferred.resolve();
    })
    return deferred.promise;
}

/**
 * Retrieve the playlist date string from the settings file
 * @returns {string} date string 
 */
function getPlaylistResetDate() {
    const file = 'playlist-reset-date.json';
    const filePath = path.join(__dirname + '/utils-resources/', file);
    var fileData = fs.readFileSync(filePath, 'utf-8');
    fileData = JSON.parse(fileData);
    if (!fileData.last_reset) { // if none set yet
        // console.log('no global playlist reset date set');
        saveDefaultGlobalPlaylistResetDate();
        return getLastSundayMidnight();
    }
    return new Date(fileData.last_reset);
}

/**
 * Save a default global reset date to the most previous Sunday.
 */
function saveDefaultGlobalPlaylistResetDate() {
    var deferred = Q.defer();
    var defaultResetDate = getLastSundayMidnight();
    saveGlobalPlaylistResetDate(defaultResetDate)
        .then(function () {
            deferred.resolve();
        })
        .catch(function (err) {
            deferred.reject(err);
        });
    return deferred.promise;
}

/**
 * @returns {Date} date object of last sunday compared to current date
 */
function getLastSundayMidnight() {
    var currentDateTime = new Date();
    var lastSunday = new Date(currentDateTime.setDate(currentDateTime.getDate() - currentDateTime.getDay()));
    
    lastSunday.setHours(23, 59, 59, 0); // set right before midnight
    return new Date(lastSunday);
}

/**
 * Save a new global reset date by moving forward one week.
 */
function saveNewGlobalPlaylistResetDate() {
    var deferred = Q.defer();
    var oldDate = getPlaylistResetDate();
    var newDate = moveDateForwardOneWeek(oldDate);
    saveGlobalPlaylistResetDate(newDate)
        .then(function () {
            deferred.resolve();
        })
        .catch(function (err) {
            deferred.reject(err);
        });
    return deferred.promise;
}

/**
 * Move a date forward one week
 * @param {Date} date 
 */
function moveDateForwardOneWeek(date) {
    var resetDate = new Date(date);
    resetDate = new Date(resetDate.setDate(date.getDate() + 7));
    return resetDate;
}

/**
 * TODO:
 * 1. what happens if no date is provided?
 */
function saveGlobalPlaylistResetDate(date) {
    const file = 'playlist-reset-date.json';
    const filePath = path.join(__dirname + '/utils-resources/', file);
    var deferred = Q.defer();
    var fileContents = {
        "last_reset": date
    }
    fileContents = JSON.stringify(fileContents, null, 4);
    fs.writeFile(filePath, fileContents, 'utf-8', function (err) {
        if (err) {
            deferred.reject(err);
        }
        deferred.resolve();
    });
    return deferred.promise;
}

// TODO: save playlist ID to document
function createPlaylist(userId) {
    var deferred = Q.defer();
    var spotifyUserApi = new SpotifyUserApi();
    // test async task
    User.findOne({
        '_id': userId
    }, function (err, user) {
        spotifyUserApi.createPlaylist(user)
            .then(function (playlistInfo) {
                console.log(playlistInfo);
                deferred.resolve();
            })
    })
    return deferred.promise;
}

// expose top level function
module.exports = {
    updateNewReleasePlaylists: updateNewReleasePlaylists
}