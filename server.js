// server.js
// where your node app starts

const Twitter = require( 'twitter' );

var twitterCreds = {
      consumer_key: process.env.CONSUMER_KEY,
      consumer_secret: process.env.CONSUMER_SECRET,
      access_token_key: process.env.ACCESS_TOKEN_KEY,
      access_token_secret: process.env.ACCESS_TOKEN_SECRET,
    };

const tweetsPerRequest = 200;
const tweetMax = 100000;
// twitter has an api limit of 180 every 15 minutes
const rateMins = 16;
const rateCalls = 180;
const minuteMs = 60 * 1000;
var msBetweenQueries = (rateMins / rateCalls) * minuteMs;

let client = new Twitter( twitterCreds );
let currentHandle = '';
let currentFavs = [];
let first = true;


var google = require('googleapis');
//var googleAuth = require('google-auth-library');

var sheets = google.sheets('v4');
var googleCreds = JSON.parse(process.env.GOOGLE_JSON);
//var googleApiKey = process.env.GOOGLE_API_KEY; nah
var oauth2Client = new google.auth.OAuth2(googleCreds.web.client_id, googleCreds.web.client_secret, googleCreds.web.redirect_uris[0]);
oauth2Client.credentials = googleCreds;

var scopes = [
  'https://www.googleapis.com/auth/spreadsheets'
];
  
google.options({
  auth: oauth2Client
});

const MAX_SHEET_ROWS = 5000;
// google sheets has an api limit of 40,000 per day
const gRateHours = 25;
const gRateCalls = 40000;
const gHourMs = 60 * 60 * 1000;
var gMsBetweenQueries = (gRateHours / gRateCalls) * gHourMs;

var authorizationCode = null;


// express stuff: 

var express = require('express');
var app = express();

// we've started you off with Express, 
// but feel free to use whatever libs or frameworks you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function (request, response) {
  console.log(`GET '/' ${Date()}`);
  response.sendFile(__dirname + '/views/index.html');
});

// twitter stuff:

app.post("/favs", function (request, response) {
  console.log(`POST '/favs' ${Date()}`);
  currentHandle = request.query.screen_name;
  
  getFavsPromise();
  
  response.sendStatus(200);
});

// original twitter code and inspiration: https://github.com/berkmancenter/tmulk/blob/master/tmulk.js

let p = null;
function getFavsPromise( ) {
  p = new Promise( getFavs );

  p.then( getFavsResolve ).catch( function ( reason ) {
    console.warn( `[error] handle: ${currentHandle}, reason: ${reason}` );
  });
}

function getFavsResolve( val ) {
  // if not the first then a max_id was used, so the first returned tweet can be skipped
  if ( !first ) {
    val = val.slice(1);
  } else {
    first = false;
  }

  console.warn( `[progress] handle: ${currentHandle}, length: ${val.length}` );
  currentFavs.push( ...val );
  console.log(`currentFavs.length: ${currentFavs.length}`);

  if ( currentFavs.length >= tweetMax || val.length === 0 ){
    console.warn( `[end] handle: ${currentHandle}` );
    
    doGoogleStuff();
  } else {
    setTimeout( getFavsPromise, msBetweenQueries );
  }
}

var getFavs = function ( resolve, reject ) {
  let timelineReq = {
    screen_name: currentHandle,
    count: tweetsPerRequest
  };

  if ( currentFavs.length > 0 ) {
    timelineReq.max_id = currentFavs[ currentFavs.length - 1 ].id_str;
  }

  console.warn( `[get]`, timelineReq );
  // https://api.twitter.com/1.1/favorites/list.json?count=200&screen_name=travis
  client.get( 'favorites/list', timelineReq, function GetTweets ( error, tweets, response ) {
    if ( !error ) {
      resolve( tweets );
    } else {
      reject( error );
    }
  });
};

// just use array of props
const tweetPropNames = ["created_at", "id", "id_str", "text", "truncated", "entities", "extended_entities", "source", "in_reply_to_status_id", 
                        "in_reply_to_status_id_str", "in_reply_to_user_id", "in_reply_to_user_id_str", "in_reply_to_screen_name", "user", 
                        "geo", "coordinates", "place", "contributors", "is_quote_status", "quoted_status_id", "quoted_status_id_str", 
                        "quoted_status", "retweet_count", "favorite_count", "favorited", "retweeted", "possibly_sensitive", "lang", 
                        // these may not be needed: 
"contributors", "current_user_retweet", "filter_level", "retweeted_status", "withheld_copyright", "withheld_in_countries", "withheld_scope"];

// tweets need to be flattened to an array of 1-dimensional arrays to be inserted into a google sheet properly
var flattenTweet = function (tweet) {
  var flat = [];
  for (var i = 0; i <= tweetPropNames.length; i++) {
    var prop = tweetPropNames[i];
    if (tweet[prop] !== null && typeof(tweet[prop]) === "object") {
      flat.push(JSON.stringify(tweet[prop]));      
    } else {
      flat.push(tweet[prop]);
    }
  }
  return flat;
};

// google sheet stuff:
let sheetData = [];
let sheetIndex = -1;

/**
 * http://cwestblog.com/2013/09/05/javascript-snippet-convert-number-to-column-name/
 * Takes a positive integer and returns the corresponding column name.
 * @param {number} num  The positive integer to convert to a column name.
 * @return {string}  The column name.
 */
function toColumnName(num) {
  for (var ret = '', a = 1, b = 26; (num -= a) >= 0; a = b, b *= 26) {
    ret = String.fromCharCode(parseInt((num % b) / a) + 65) + ret;
  }
  return ret;
}

var endColumnRange = toColumnName(tweetPropNames.length);

var doGoogleStuff = function () {
  console.log(`starting doGoogleStuff: currentFavs.length: ${currentFavs.length}, sheetIndex: ${sheetIndex}, sheetData.length: ${sheetData.length}`);
  
  var tweetHeaders = tweetPropNames;
  for (var i = 0; i <= currentFavs.length; i++) {
    // break up tweets into arrays of 5000 (MAX_SHEET_ROWS)
    if (i === 0 || (i % (MAX_SHEET_ROWS - 1)) === 0) {
      sheetIndex++;
      sheetData.push([]);
      console.log(`sheetIndex: ${sheetIndex}, sheetData.length: ${sheetData.length}`);
      // first row is headers (attr names), for complex props just do JSON.stringify( val )
      sheetData[sheetIndex].push(tweetHeaders);
    }
    if (currentFavs[i]) {
      sheetData[sheetIndex].push(flattenTweet(currentFavs[i]));
    } else {
      console.warn(`tweet at index:${i} is undefined?`);
    }
    
  }
  
  putItInTheSheets();
};

var valueIndex = 0;
var putItInTheSheets = function () {
  console.log(`starting putItInTheSheets: valueIndex: ${valueIndex}, sheetData.length: ${sheetData.length}`);
  if (valueIndex >= sheetData.length) {
    console.log("All done!");
    return;
  }
  // send each value array to makeSheet
  // wait gMsBetweenQueries after makeSheet
  // use id from makeSheet and send it to appendSheetData
  // wait gMsBetweenQueries after appendSheetData
  makeSheet(sheetData[valueIndex]);
  valueIndex++;
};

var makeSheet = function (values) {
  console.log(`starting makeSheet: values.length: ${values.length}`);
  //authorize(function makeSheetAuthorized (authClient) {
    var request = {
      resource: {
        "properties": {
          "title": "getallfavs-" + (new Date()).toISOString() // use getTime() instead?
        },
      },

      auth: oauth2Client
    };

    sheets.spreadsheets.create(request, function CreateSheet(err, response) {
      if (err) {
        console.log(err);
        return;
      }
      
      setTimeout(function () {
        appendSheetData(response.spreadsheetId, values);
      }, gMsBetweenQueries);
    });
  //});
};

var appendSheetData = function (sheetId, values) {
    console.log(`starting appendSheetData: sheetId: ${sheetId}, values.length: ${values.length}`);
  //authorize(function appendSheetDataAuthorized (authClient) {
    var request = {
      // The ID of the spreadsheet to update.
      spreadsheetId: sheetId,
      
      // The A1 notation of a range to search for a logical table of data.
      // Values will be appended after the last row of the table.
      range: 'Sheet1!A1:' + endColumnRange + '1',

      // How the input data should be interpreted.
      valueInputOption: 'RAW',
      
      // How the input data should be inserted.
      insertDataOption: 'INSERT_ROWS',
      
      resource: {
        "range":"Sheet1!A1:" + endColumnRange + "1",
        "majorDimension": "ROWS",
        "values": values
      },

      auth: oauth2Client
    };

    sheets.spreadsheets.values.append(request, function AppendSheet(err, response) {
      if (err) {
        console.log(err);
        return;
      }
      setTimeout(putItInTheSheets, gMsBetweenQueries);
    });
  //});
};

function authorize() {
  var url = oauth2Client.generateAuthUrl({
    // 'online' (default) or 'offline' (gets refresh_token)
    access_type: 'offline',
    scope: scopes
  });
  
  console.log(url);

  if (oauth2Client === null) {
    console.log('authentication failed');
    return;
  }
  return url;
}

app.get("/auth", function AppAuth (request, response) {
  console.log(`GET '/auth' ${Date()}`);
  response.redirect(authorize());
});

app.get("/oauth2callback", function AppCallback (request, response) {
  console.log(`GET '/oauth2callback' ${Date()}`);
  authorizationCode = request.query.code;

  oauth2Client.getToken(authorizationCode, function (err, tokens) {
    if (!err) {
      oauth2Client.setCredentials(tokens);
      response.redirect("/?ok!");
    }
  });
});



// listen for requests :)
var listener = app.listen(process.env.PORT, function AppListener() {
  console.log('Your app is listening on port ' + listener.address().port);
});
