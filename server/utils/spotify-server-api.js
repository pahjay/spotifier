/** This file handles all the client authenticated calls to the spotify api. **/
var SpotifyApi = require('spotify-web-api-node'),
    Q = require('q'),
    fs = require('fs'),
    path = require('path'),
    credentials = {
        clientId: '5c3f5262d39e44ec999a8a0a9babac3e',
        clientSecret: 'a0d232e3a1844de785777c20944f2618'
    },
    spotifyApi = new SpotifyApi(credentials); // instantiate api object

var self = module.exports = {

    refreshClientToken: function () {
        var deferred = Q.defer();
        // request new access token
        spotifyApi.clientCredentialsGrant()
            .then(function (data) {
                // apply
                spotifyApi.setAccessToken(data.body.access_token);
                deferred.resolve();
            })
            .catch(function (err) {
                console.log(err);
                deferred.reject(err);
            });
        return deferred.promise;
    },

    getRecentRelease: function (artist) {
        var deferred = Q.defer();
        // ensure fresh token
        self.refreshClientToken()
            .then(function () {

                /**
                 * releases are organized in this order
                 * 1. full album releases
                 * 2. singles
                 * 3. EPs
                 */
                self.getArtistReleases(artist)
                    .then(function(releases) {
                        // console.log(releases);
                        if (releases.length > 0) {
                            // get most recent album details
                            self.getAlbumInfo(releases[0].id)
                                .then(function(album) {
                                    var i = 1; // start at one because we already parses 0
                                    //
                                    while (i < releases.length && releases[i].album_type === 'album') {
                                       i++;
                                    }
                                    // if artist single exists
                                    if (releases[i] && releases[i].album_type === 'single'){
                                        // get most recent single details
                                        self.getAlbumInfo(releases[i].id)
                                            .then(function(single) {
                                                // iterate to artist EPs
                                                while(i < releases.length && releases[i].album_type === 'single') {
                                                    i++;
                                                }
                                                // if EP exists
                                                if (releases[i] && releases[i].album_type === 'album') {
                                                    // console.log(releases[i]);
                                                    self.getAlbumInfo(releases[i].id)
                                                        .then(function(ep) {
                                                            // console.log(ep);
                                                            var releases = [album, single, ep];
                                                            // sort releases by date descending
                                                            releases.sort(function(a,b) {
                                                                if (a.release_date < b.release_date)
                                                                    return 1; // assign a to the right of b
                                                                if (a.release_date > b.release_date)
                                                                    return -1; // assign a to the left of b
                                                                else
                                                                    return 0; // do not change assignment
                                                            });
                                                            // return most recent of the three
                                                            deferred.resolve(releases[0]);
                                                        })
                                                } else {
                                                    // compare album and single
                                                    var albumDate = Date.parse(album.release_date),
                                                        singleDate = Date.parse(single.release_date);
                                                    // check which one was released most recent
                                                    if (albumDate < singleDate) {
                                                        deferred.resolve(single);
                                                    } else {
                                                        deferred.resolve(album);
                                                    }
                                                }
                                            })
                                    } else {
                                        // return most recent album/EP
                                        deferred.resolve(album);
                                    }
                                })
                                .catch(function(err) {
                                    deferred.reject(err);
                                })
                        } else {
                            // no albums currently on spotify
                            deferred.resolve();
                        }
                    })
                    .catch(function(err) {
                        console.log(err);
                        deferred.reject(err);
                    })
            })
            .catch(function (err) {
                deferred.reject('**REFRESH CLIENT TOKEN**' + err);
            });
        return deferred.promise;
    },

    /**
     * Create an array of artist releases, limiting results to albums and singles.
     * @param artist
     * @returns {Q.Promise<T>}
     */
    getArtistReleases: function(artist) {
        var deferred = Q.defer(),
            offset = 0,
            limit = 50,
            releases = [];

        run();
        function run() {
            spotifyApi.getArtistAlbums(artist.spotify_id, ({
                limit: limit,
                offset: offset,
                album_type: 'album,single'
            }))
                .then(function(data) {
                    releases = releases.concat(data.body.items);
                    offset += limit;
                    if (offset < data.body.total) {
                        run();
                    } else {
                        deferred.resolve(releases);
                    }
                })
                .catch(function(err) {
                    console.log(err);
                    run();
                })
        }
        return deferred.promise;
    },

    getAlbumInfo: function (albumId) {
        var deferred = Q.defer();
        self.refreshClientToken()
            .then(function () {
                spotifyApi.getAlbum(albumId)
                    .then(function (data) {
                        deferred.resolve(data.body);
                    })
                    .catch(function (err) {
                        deferred.reject('**GET ALBUM**' + err);
                    })
            })
            .catch(function (err) {
                deferred.reject(err);
            });
        return deferred.promise;
    },

    getRecentReleaseId: function (artist) {
        var deferred = Q.defer();
        self.refreshClientToken()
            .then(function () {
                spotifyApi.getArtistAlbums(artist.spotify_id, ({
                    limit: 1,
                    offset: 0
                }))
                    .then(function (data) {
                        deferred.resolve(data.body.items[0].id);
                    })
                    .catch(function (err) {
                        deferred.reject('**GET ARTIST ALBUMS**' + err);
                    })
            })
            .catch(function (err) {
                deferred.reject(err);
            });
        return deferred.promise;
    },

    /**
     * Gets all albums released in the last two weeks.
     */
    getNewReleases: function () {
        console.log('grabbing new releases from Spotify!');
        var deferred = Q.defer();
        var releases = {};
        var artistAdded = {};
        var query = 'tag:new';
        var checkDate = new Date();
        checkDate.setDate(checkDate.getDate() - 1); // 24 hours
        var p = path.join(__dirname, './cache/cached-new-releases.txt');
        var cachedReleases = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : undefined;
        if (cachedReleases) {
            console.log('new releases parsed from cache file.');
            cachedReleases = JSON.parse(cachedReleases);
        } else {
            cachedReleases = {};
        }

        // if syncDate has not been set or syncDate is older than 24 hours from this point
        if (cachedReleases.syncDate === undefined || Date.parse(cachedReleases.syncDate) < checkDate){
            console.log('cached releases out of date. Writing new releases...');
            cachedReleases.syncDate = new Date();
            self.refreshClientToken()
                .then(function () {
                    run();
                    var offset = 0;
                    function run() {
                        spotifyApi.searchAlbums(query, {
                            limit: 50,
                            offset: offset
                        })
                            .then(function (data) {
                                for (var i = 0; i < data.body.albums.items.length; i++) {
                                    var album = {
                                        spotify_id: data.body.albums.items[i].artists[0].id,
                                        name: data.body.albums.items[i].artists[0].name,
                                        recent_release: {
                                            id: data.body.albums.items[i].id,
                                            title: data.body.albums.items[i].name,
                                            images: data.body.albums.items[i].images,
                                            url: data.body.albums.items[i].external_urls.spotify
                                        }
                                    };

                                    releases[album.spotify_id] ? releases[album.spotify_id].push(album) : releases[album.spotify_id] = [album];
                                    // releases.push(album);
                                    // if (!artistAdded[album.name]){
                                    //     artistAdded[album.name] = true;
                                    //     releases.push(album);
                                    // }
                                }
                                offset = offset + 50;
                                if (offset < data.body.albums.total) {
                                    run();
                                } else {
                                    console.log('Last two weeks of releases from Spotify grabbed!');
                                    cachedReleases.releases = releases;
                                    fs.writeFile(path.join(__dirname, './cache/cached-new-releases.txt'), JSON.stringify(cachedReleases, null, 4), {encoding: 'utf-8', flag: 'w'}, function(err) {
                                        if (err) {
                                            console.log(err);
                                        }
                                    });
                                    console.log('did we get here?');
                                    deferred.resolve(releases);
                                }
                            })
                            .catch(function (err) {
                                console.log(err);
                                run();
                            })
                    }
                })
                .catch(function (err) {
                    console.log(err);
                });
        } else {
            deferred.resolve(cachedReleases.releases);
        }

        return deferred.promise;
    },

    // USED FOR TESTING PURPOSES ONLY
    // DUPLICATE CODE DUE TO MAINTAINING PROD METHOD READABILITY
    getSecondRecentRelease: function (artist) {
        var deferred = Q.defer();
        // ensure fresh token
        self.refreshClientToken()
            .then(function () {
                // retrieve most recent release
                spotifyApi.getArtistAlbums(artist.spotify_id, ({
                    limit: 9,
                    offset: 0
                }))
                    .then(function (data) {
                        var albumId;
                        var i = 0;
                        // skip generic artists like 'various artists' who don't have any album releases
                        if (data.body.items.length > 0) {
                            // skip international releases to find next new album
                            while (data.body.items[0].name === data.body.items[i].name) {
                                if (i < data.body.items.length - 1){
                                    i++;
                                } else {
                                    if (i === 0) {console.log('artist only had one release!');}
                                    break;
                                }
                            }
                            albumId = data.body.items[i].id;
                            self.getAlbumInfo(albumId)
                                .then(function (data) {
                                    deferred.resolve(data);
                                })
                                .catch(function (err) {
                                    deferred.reject('**GET ALBUM INFO**' + err);
                                })
                        } else {
                            deferred.resolve();
                        }
                    })
                    .catch(function (err) {
                        deferred.reject(err);
                    })
            })
            .catch(function (err) {
                console.log(err);
                deferred.reject('**REFRESH CLIENT TOKEN**' + err);
            });
        return deferred.promise;
    }
};





























