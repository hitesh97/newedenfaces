// TODO: add hotness meter
// TODO: Add avatar vs avatar fights (8hr rounds)
// TODO: Display current round vote history on stats page
// TODO: Remote fat footer, and add static links like on SpinKit
// TODO: FOCUS ON PERFORMANCE
// TODO: mongoose error handling middleware
// TODO: scheduler to remove lowest ranked every day
// TODO: make a new collections for storing Previous Votes for each character
// TODO: add characteristic to profile page that user can select from dropdown:
         // http://ideonomy.mit.edu/essays/traits.html

// TODO: jquery wait until image loaded on profile page
// TODO: set minimum width/height on homepage thumbnails to prevent sliding of DOM
// TODO: reset every 200 rounds
// TODO: socket.io real time number of characters

var async = require('async');
var express = require('express');
var mongoose = require('mongoose');
var path = require('path');
var request = require('request');
var xml2js = require('xml2js');
var _ = require('underscore');
var config = require('./config.json');

// OpenShift configuration
var IP_ADDRESS = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1';
var PORT = process.env.OPENSHIFT_NODEJS_PORT || 8080;

var app = express();

// Express configuration
app.use(express.json());
app.use(express.urlencoded());
app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'app')));
app.use(function(err, req, res, next) {
  console.error(err.stack);
  res.send(500, { message: err.message });
});

// MongoDB configuration
mongoose.connect(config.db, {
  server: {
    auto_reconnect: true,
    poolSize: 10,
    socketOptions: {
      keepAlive: 1
    }
  },
  db: {
    numberOfRetries: 1000,
    retryMiliSeconds: 1000
  }
});

// Character schema
var Character = mongoose.model('Character', {
  characterId: { type: String, unique: true, index: true },
  name: String,
  race: String,
  gender: String,
  wrongGender: Boolean,
  bloodline: String,
  wins: { type: Number, default: 0, index: true },
  losses: { type: Number, default: 0 },
  reports: { type: Number, default: 0 },
  random: { type: [Number], index: '2d' },
  voted: { type: Boolean, default: false }
});

/**
* GET /api/characters
* Retrieves 2 characters per user and increments global counter.
*/
app.get('/api/characters', function(req, res, next) {
  var choices = { 0: 'female', 1: 'male' };
  var randomGender = choices[Math.round(Math.random())];
  Character
    .find({ random: { $near: [Math.random(), 0] } })
    .where('voted', false)
    .where('gender', randomGender)
    .limit(2)
    .exec(function(err, characters) {
      if (err) return next(err);

      // When there are no more character pairs given by randomGender,
      // check if there are character pairs of the opposite gender
      if (characters.length < 2) {
        var oppositeRandomGender = randomGender === 'female' ? 'male' : 'female';
        Character
          .find({ random: { $near: [Math.random(), 0] } })
          .where('voted', false)
          .where('gender', oppositeRandomGender)
          .limit(2)
          .exec(function(err, characters) {
            if (err) return next(err);

            // When there are no character pairs left of either gender,
            // reset voted flags, and start the next round
            if (characters.length < 2) {
              Character.update({}, { $set: { voted: false } }, { multi: true }, function(err) {
                if (err) return next(err);
                return res.send([]);
              });
            }

            // Send two characters of oppositeRandomGender
            return res.send(characters);
          });
      }

      // Send two characters of randomGender
      res.send(characters);
    });
});

/**
* POST /report
* Increment character's report count. After (5) successive strikes,
* that character gets deleted from the database.
*/
app.post('/api/report', function(req, res) {
  var characterId = req.body.characterId;
  Character.findOne({ characterId: characterId }, function(err, character) {
    if (err) return res.send(err);
    if (character) {
      character.reports++;
      if (character.reports >= 5) {
        var url = req.protocol + '://' + req.host + ':' + PORT +
          '/api/characters/' + characterId + '?secretCode=' + config.secretCode;
        request.del(url);
        res.send(200);
      } else {
        character.save(function(err) {
          if (err) return res.send(err);
          res.send(200, character.name + ' has been reported');
        });
      }
    } else {
      res.send(404);
    }
  });
});

/**
* POST /report/gender
* Marks a character as being an invalid gender,
* e.g. Actual "male" avatar has been added as "female"
*/
app.post('/api/report/gender', function(req, res) {
  var characterId = req.body.characterId;
  Character.findOne({ characterId: characterId }, function(err, user) {
    if (err) return res.send(err);
    if (user) {
      user.wrongGender = true;
      user.save(function(err) {
        if (err) return res.send(err);
        res.send(200);
      });
    } else {
      res.send(404);
    }
  });
});

/**
* DEL /api/characters/:id
* Delete a character from the database
* Requres the secret code as a querystring to prevent abuse
*/
app.del('/api/characters/:id', function(req, res) {
  var characterId = req.params.id;
  if (req.query.secretCode !== config.secretCode) {
    return res.send(500);
  }
  Character.remove({ characterId: characterId }, function(err) {
    if (err) return res.send(err);
    res.send(200);
  });
});

/**
* PUT /api/vote
* Update winning and losing count for characters.
*/
app.put('/api/characters', function(req, res) {
  var winner = req.body.winner;
  var loser = req.body.loser;
  if (!winner || !loser) return res.send(404);
  Character.findOne({ characterId: winner }, function(err, winner) {
    if (err) return res.send(500);
    Character.findOne({ characterId: loser }, function(err, loser) {
      if (err) return res.send(500);
      if (!winner || !loser) return res.send(404);
      if (winner.voted || loser.voted) return res.send(200);
      async.parallel([
        function(callback) {
          winner.wins++;
          winner.voted = true;
          winner.random = [Math.random(), 0];
          winner.save(function(err) {
            callback(null);
          });
        },
        function(callback) {
          loser.losses++;
          loser.voted = true;
          loser.random = [Math.random(), 0];
          loser.save(function(err) {
            callback(null);
          });
        }
      ], function(err) {
        res.send(200);
      });
    });
  });
});

/**
* GET /api/characters/shame
* Return top (100) lowest ranked characters for the hall of shame
*/
app.get('/api/characters/shame', function(req, res) {
  Character
  .find()
  .sort('-losses')
  .limit(100)
  .exec(function(err, characters) {
    if (err) return res.send(err);
    res.send(characters);
  });
});

/**
 * GET /delete/:id
 * Delete a character
 */
//app.get('/delete/:id', function(req, res) {
//  var id = req.params.id;
//  Character.remove({ characterId: id}, function(err, status) {
//    console.log(err, status);
//  });
//});

/**
 * GET /api/characters/new
 * Return top (100) newest characters
 */
app.get('/api/characters/new', function(req, res) {
  Character
    .find()
    .sort({ _id: -1})
    .limit(100)
    .exec(function(err, characters) {
      if (err) return res.send(err);
      res.send(characters);
    });
});

/**
* GET /api/characters/top
* Return top (100) highest ranked characters.
* Filter gender, race, bloodline by a querystring.
*/
app.get('/api/characters/top', function(req, res) {
  var conditions = {};
  for (var key in req.query) {
    if (req.query.hasOwnProperty(key)) {
      conditions[key] = new RegExp('^' + req.query[key] + '$', 'i');
    }
  }
  Character.find(conditions).sort('-wins').limit(150).exec(function(err, characters) {
    if (err) return res.send(err);
    characters.sort(function(a, b) {
      if (a.wins / (a.wins + a.losses) < b.wins / (b.wins + b.losses)) return 1;
      if (a.wins / (a.wins + a.losses) > b.wins / (b.wins + b.losses)) return -1;
      return 0;
    });
    res.send(characters.slice(0, 100));
  });
});


/**
* GET /api/leaderboard
* Returns Top 12 characters, sorted by the winning percentage.
*/
app.get('/api/leaderboard', function(req, res) {
  Character
  .find()
  .sort('-wins')
  .limit(18)
  .lean()
  .exec(function(err, characters) {
    if (err) return res.send(err);
    characters.sort(function(a, b) {
      if (a.wins / (a.wins + a.losses) < b.wins / (b.wins + b.losses)) return 1;
      if (a.wins / (a.wins + a.losses) > b.wins / (b.wins + b.losses)) return -1;
      return 0;
    });
    res.send(characters.slice(0,12));
  });
});

/**
* GET /api/characters/all
* Returns a total count of characters in the DB
*/
app.get('/api/characters/all', function(req, res) {
  Character.count({}, function(err, count) {
    if (err) return res.send(err);
    res.send({ count: count });
  });
});

/**
 * POST /api/characters/search
 * Character search
 */
app.post('/api/characters/search', function(req, res) {
  var characterName = new RegExp(req.body.name, 'i');
  Character.findOne({ name: characterName }, function(err, character) {
    if (err) return res.send(err);
    if (character) {
      res.send(character);
    } else {
      res.send({});
    }
  });
});

/**
 * Display characters marked as Wrong Gender
 */
app.get('/api/characters/wrong-gender', function(req, res) {
  Character.where('wrongGender', true).exec(function(err, characters) {
    if (err) return res.send(err);
    res.send(characters);
  });
});

/**
* GET /api/characters/:id
* Return detailed character information
*/
app.get('/api/characters/:id', function(req, res, next) {
  Character.findOne({ characterId: req.params.id }, function(err, character) {
    if (err) return next(err);
    if (character) {
      res.send(character);
    } else {
      res.send(404);
    }
  });
});

/**
* POST /api/characters
* Add character to the database
*/
app.post('/api/characters', function(req, res) {
  var parser = new xml2js.Parser();

  var gender = req.body.gender;
  var charName = decodeURIComponent(req.body.name || '');
  var characterIdUrl = 'https://api.eveonline.com/eve/CharacterID.xml.aspx?names=' + charName;
  async.waterfall([
    function(callback) {
      request.get(characterIdUrl, function(e, r, xml) {
        if (e) throw e;
        parser.parseString(xml, function(err, parsedXml) {
          if (err) return res.send(err);
          try {
            var characterId = parsedXml.eveapi.result[0].rowset[0].row[0].$.characterID;

            Character.findOne({ characterId: characterId }, function(err, character) {
              if (character) {
                res.send(409, { characterId: character.characterId });
              } else {
                callback(null, characterId);
              }
            });

          } catch(e) {
            return res.send(404, 'Character ID Not Found');
          }

        });
      });
    },
    function(characterId, callback) {
      var characterInfoUrl = 'https://api.eveonline.com/eve/CharacterInfo.xml.aspx?characterID=' + characterId;
      request.get({ url: characterInfoUrl }, function(e, r, xml) {
        if (e) return res.send(500);
        parser.parseString(xml, function(err, parsedXml) {
          if (err) return res.send(err);
          try {
            var name = parsedXml.eveapi.result[0].characterName[0];
            var race = parsedXml.eveapi.result[0].race[0];
            var bloodline = parsedXml.eveapi.result[0].bloodline[0];

            var character = new Character({
              characterId: characterId,
              name: name,
              race: race,
              bloodline: bloodline,
              gender: gender,
              random: [Math.random(), 0]
            });

            character.save(function(err) {
              if (err) return res.send(500);
              res.send(character);
            });

            callback(null);

          } catch(e) {
            return res.send(404, 'Character Info Not Found');
          }

        });
      });
    }
  ]);
});

/**
 * GET /api/stats
 * Display DB statistics
 */
app.get('/api/stats', function(req, res) {
  async.parallel([
    function(callback) {
      Character.count({}, function(err, count) {
        callback(err, count);
      });
    },
    function(callback) {
      Character.count({ race: 'Amarr'}, function(err, amarrCount) {
        callback(err, amarrCount);
      });
    },
    function(callback) {
      Character.count({ race: 'Caldari' }, function(err, caldariCount) {
        callback(err, caldariCount);
      });
    },
    function(callback) {
      Character.count({ race: 'Gallente' }, function(err, gallenteCount) {
        callback(err, gallenteCount);
      });
    },
    function(callback) {
      Character.count({ race: 'Minmatar' }, function(err, minmatarCount) {
        callback(err, minmatarCount);
      });
    },
    function(callback) {
      // Total males
      Character.count({ gender: 'male' }, function(err, maleCount) {
        callback(err, maleCount);
      });
    },
    function(callback) {
      // Total females
      Character.count({ gender: 'female' }, function(err, femaleCount) {
        callback(err, femaleCount);
      });
    },
    function(callback) {
      // Total votes cast
      Character.aggregate(
        { $group: { _id: null, total: { $sum: '$wins' } } },
        function(err, winsCount) {
          callback(err, winsCount[0].total);
        }
      );
    },
    function(callback) {
      // Race count in Top 100
      Character
        .find()
        .sort('-wins')
        .limit(100)
        .select('race')
        .exec(function(err, characters) {
          var raceCount = _.countBy(characters, function(character) {
            return character.race
          });
          var max = _.max(raceCount, function(race) { return race });
          var inverted = _.invert(raceCount);
          var topRace = inverted[max];
          var topCount = raceCount[topRace];
          callback(err, { race: topRace, count: topCount });
      });
    }
  ],
  function(err, results) {
    if (err) return res.send(500, err);

    var totalCount = results[0];
    var amarrCount = results[1];
    var caldariCount = results[2];
    var gallenteCount = results[3];
    var minmatarCount = results[4];
    var maleCount = results[5];
    var femaleCount = results[6];
    var totalVotes = results[7];
    var leadingRace = results[8];

    res.send({
      totalCount: totalCount,
      amarrCount: amarrCount,
      caldariCount: caldariCount,
      gallenteCount: gallenteCount,
      minmatarCount: minmatarCount,
      maleCount: maleCount,
      femaleCount: femaleCount,
      totalVotes: totalVotes,
      leadingRace: leadingRace
    });
  });
});

/**
* POST /api/gender
* Update character's gender.
*/
app.post('/api/gender', function(req, res) {
  var id = req.body.characterId;
  var gender = req.body.gender;
  Character.findOne({ characterId: id}, function(err, character) {
    if (err) return res.send(500, { message: err.message });
    if (character) {
      character.gender = gender;
      character.wrongGender = false;
      character.save(function(err) {
        if (err) return res.send(err);
        res.send(200);
      });
    }
  });
});

app.listen(PORT, IP_ADDRESS, function() {
  console.log('Express started listening on %s:%d', IP_ADDRESS, PORT);
});
