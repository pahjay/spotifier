/**
 * Created by ryan on 7/18/2017.
 */
var express = require('express'),
    passport = require('passport'),
    Db = require('../utils/db.js'),
    email = require('../utils/email'),
    logger = require('../utils/logger'),
    router = express.Router();

router.get('/login', passport.authenticate('spotify', {
        scope: ['user-read-private', 'user-read-email', 'user-library-read', 'playlist-modify-private', 'playlist-modify-public', 'playlist-read-private', 'playlist-read-collaborative'],
        showDialog: true
    }),
    // callback function
    function (req, res) {
        // this request redirects to spotify so it wont be called
    });

router.get('/logout', function (req, res) {
    req.logout();
    res.redirect('/');
});

router.get('/get', function (req, res) {
    if (req.user) {
        var user = {
            _id: req.user._id,
            name: req.user.name
        };
        return res.status(200).json({
            user: user
        })
    } else {
        return res.status(500).json({
            err: 'user not found!'
        })
    }
});

router.get('/status', function (req, res) {
    if (!req.isAuthenticated()) {
        return res.status(200).json({
            isAuthenticated: false
        })
    }
    // return success
    return res.status(200).json({
        isAuthenticated: true
    })
});

router.get('/callback',
    passport.authenticate('spotify', {
        failureRedirect: '/'
    }),
    function (req, res) {
        var db = new Db();
        db.createUser(req.user) // creates new user object in db if it doesn't already exist
            .then(function (user) {
                // save the database id in the cookie
                req.session.passport.user._id = user._id;
                req.session.save(function (err) {
                    if (err) {
                        logger.error(err);
                    }
                });
                db.emailExists(user)
                    .then(function (exists) {
                        // if user email does not exist
                        if (!exists) {
                            res.redirect('/email');
                        } else {
                            db.emailConfirmed(user)
                                .then(function (confirmed) {
                                    // if user has not confirmed their email
                                    if (!confirmed) {
                                        res.redirect('/confirm-pending');
                                    } else {
                                        // user has a confirmed email
                                        res.redirect('/library');
                                    }
                                })
                        }
                    })
            })
            .catch(function (err) { // create user err catch
                logger.error(err);
            });


        // DEBUGGING
        process.env.NODE_ENV ? null : res.redirect('/library');
    });

/**
 * API endpoint for inserting/updating a user's email into the database.
 */
router.post('/email/add', function (req, res) {
    var db = new Db();
    db.addEmail(req.user, req.body.emailAddress)
        .then(function () {
            res.status(200).send();
        })
        .catch(function (err) {
            return res.status(500).json({
                err: err
            })
        })
});

/**
 * API endpoint for deleting a user's email from the database.
 */
router.post('/email/delete', function (req, res) {
    var db = new Db();
    db.removeEmail(req.user)
        .then(function () {
            res.status(200).send();
        })
        .catch(function (err) {
            return res.status(500).json({
                err: err
            })
        })
});

router.get('/email/send-confirmation', function (req, res) {
    email.sendConfirmationEmail(req.user)
        .catch(function (err) {
            return res.status(500).json({
                err: err
            })
        });
    res.status(200).send();
});

/**
 * API endpoint for confirming a user's email in the database.
 */
router.get('/email/confirm', function (req, res) {
    email.confirm(req.query)
        .then(function () {
            var t = encodeURIComponent('true');
            res.redirect('/confirmation?success=' + t);
        })
        .catch(function (err) {
            var f = encodeURIComponent('false');
            res.redirect('/confirmation?success=' + f);
        })
});

/**
 * API endpoint for getting a user's email authentication status.
 */
router.get('/email/status', function (req, res) {
    email.getStatus(req.user)
        .then(function (confirmed) {
            return res.status(200).json({
                isConfirmed: confirmed
            })
        })
        .catch(function (err) {
            return res.status(500).json({
                err: err
            })
        })
});

/**
 * endpoint for unsubscribing a user's email
 */
router.post('/email/unsubscribe', function (req, res) {
    var db = new Db();
    db.unsubscribeEmail(req.body.email)
        .then(function () {
            res.status(200).send();
        })
        .catch(function () {
            res.status(500).send();
        })
});

/**
 * API endpoint for receiving email bounces from Amazon SES.
 * Will call db handler and remove user emails that bounce.
 */
router.post('/email/bounce', function (req, res) {
    // console.log('we bounced!');
    // console.log(req.body);
    // res.sendStatus(200);
    const db = new Db();
    var chunks = [];
    req.on('data', function (chunk) {
        chunks.push(chunk);
    });
    req.on('end', function () {
        var body = JSON.parse(chunks.join(''));
        if (body.Type == 'Notification') {
            const message = JSON.parse(body.Message);
            console.log(message.bounce.bouncedRecipients);
            for (let recipient of message.bounce.bouncedRecipients) {
                db.unsubscribeEmail(recipient.emailAddress);
            }
        } else {
            console.log(body);
        }
    });
    res.end();
});

/**
 * API endpoint for getting notifications for Amazon SES spam complaints.
 * Will call db handler and remove user email's who return complaints.
 */
router.post('/email/complaint', function (req, res) {
    // TODO:
});

/**
 * API endpoint for getting notifications for Amazon SES deliveries.
 */
router.post('/email/delivery', function (req, res) {
    // TODO:
});

/**
 * Called on playlist enabled checkbox change
 */
router.post('/setting/playlist-update', function (req, res) {
    var db = new Db();
    db.changeUserPlaylistSetting(req.user._id, req.body.playlistEnabled)
        .then(function (playlistEnabled) {
            return res.status(200).json({
                playlistEnabled: playlistEnabled
            });
        })
        .catch(function (err) {
            return res.status(500).json({
                err: err
            });
        });
});

/**
 * Return the current playlist enabled state for a user
 */
router.get('/setting/playlist', function (req, res) {
    var db = new Db();
    db.getUserPlaylistSetting(req.user._id)
        .then(function (playlistEnabled) {
            return res.status(200).json({
                playlistEnabled: playlistEnabled
            });
        })
        .catch(function (err) {
            return res.status(500).json({
                err: err
            });
        });
});

router.post('/setting/sync-scheduled-update', function (req, res) {
    var db = new Db();
    db.changeUserSyncSchedule(req.user._id, req.body.scheduled)
        .then(function (enabled) {
            return res.status(200).json({
                scheduled: enabled
            });
        })
        .catch(function (err) {
            return res.status(500).json({
                err: err
            })
        });
});

router.get('/setting/sync-scheduled', function (req, res) {
    var db = new Db();
    db.getUserSyncSchedule(req.user._id)
        .then(function (scheduled) {
            return res.status(200).json({
                scheduled: scheduled
            });
        })
        .catch(function (err) {
            return res.status(500).json({
                err: err
            });
        });
});

module.exports = router;