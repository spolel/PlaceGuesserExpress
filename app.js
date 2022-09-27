import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import cors from 'cors';

import { createClient } from '@supabase/supabase-js'
import { Client } from "@googlemaps/google-maps-services-js";

import { bounds } from "./countryBoundingBoxes.js"

dotenv.config();

const app = express();
app.use(bodyParser.json())
app.use(cors())
const port = process.env.PORT;
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_KEY

const supabase = createClient(
  supabaseUrl,
  supabaseKey
)

const gmaps = new Client({});


app.get('/', (req, res) => {
  res.send('Express Server');
});

app.get('/test', async (req, res) => {
  const { data, error } = await supabase.from('random_places').select().limit(1)
  res.send(data)
});

app.get('/testgeo', async (req, res) => {
  //.eq("country code", "CN")
  const { data, error } = await supabase.from('random_places').select().limit(1)
  const randomPlace = { lat: data[0].latitude, lng: data[0].longitude }
  console.log("Random place: ", data[0].name, ", ", data[0]["country code"])
  console.log(randomPlace.lat, ", ", randomPlace.lng)

  const geocodeResult = await reverseGeocode(randomPlace)
  const placeIds = []
  geocodeResult.forEach(x => {
    placeIds.push(x.place_id)
  })
  // console.log(placeIds)

  const details = await getPlaceDetails(placeIds[0])
  console.log("Found place: ", geocodeResult[0].formatted_address)
  console.log(details.geometry.location.lat, ", ", details.geometry.location.lng)

  details.formatted_address = geocodeResult[0].formatted_address
  res.send(details)

  // for (let i = 0; i < placeIds.length; i++) {
  //   const details = await getPlaceDetails(placeIds[i])
  //   if (details.photos != undefined) {
  //     console.log(i)
  //     console.log(details.name)
  //     console.log(details.geometry.location)
  //     res.send(details)
  //     break
  //   }
  // }

});

//google api call to reversegeocode coordinates
async function reverseGeocode(randomPlace) {
  const result = await gmaps
    .reverseGeocode({
      params: {
        latlng: randomPlace,
        key: process.env.GOOGLE_MAPS_API_KEY,
        result_type: ["locality", "political"]
        //"plus_code"
      }
    })
    .then((r) => {
      return r.data.results
    })
    .catch((e) => {
      console.log(e.response.data.error_message);
    });

  return result
}

//google api call to get details from placeid
async function getPlaceDetails(placeId) {
  const details = await gmaps
    .placeDetails({
      params: {
        place_id: placeId,
        key: process.env.GOOGLE_MAPS_API_KEY,
        fields: ['name', 'geometry', 'photos']
      }
    })
    .then((r) => {
      //console.log(r.data.result);
      return r.data.result
    })
    .catch((e) => {
      console.log(e.response.data.error_message);
    });
  return details
}

//random place is chosen from database,
//the google reverse geocoding is run on coordinates
//after getting the closest result we request details to google api
//in the end return place details and photos
app.get('/get_random_place', async (req, res) => {
  const pop = req.query.pop
  const zone = req.query.zone
  const countrycode = req.query.countrycode

  let place;
  if (zone == 'worldwide') {
    const { data, error } = await supabase.from('random_places').select().gte('population', parseInt(pop)).limit(1)
    place = data;
  } else if (countrycode != undefined) {
    const { data, error } = await supabase.from('random_places').select().eq("country code", countrycode).gte('population', parseInt(pop)).limit(1)
    place = data;
  } else {
    const continents = {
      "africa": ["Africa"],
      "americas": ["North America", "South America"],
      "europe": ["Europe"],
      "asia": ["Asia"],
      "oceania": ["Oceania"],
      "asia/oceania": ["Asia", "Oceania"]
    }

    const { data, error } = await supabase.from('random_places').select().in('continent', continents[zone]).gte('population', parseInt(pop)).limit(1)
    place = data;
  }

  const randomPlace = { lat: place[0].latitude, lng: place[0].longitude }
  console.log("Random place: ", place[0].asciiname, ", ", place[0]["country code"])
  console.log(randomPlace.lat, ", ", randomPlace.lng)

  const geocodeResult = await reverseGeocode(randomPlace)

  let containsNameIndex;
  let localityIndex;
  let biggestSublocalityIndex;
  let firstPoliticalIndex = 0;

  for (let i = geocodeResult.length - 1; i >= 0; i--) {
    //console.log(geocodeResult[i].formatted_address.split(','))
    //console.log(geocodeResult[i].formatted_address.split(',')[0].toLowerCase(), " ", place[0].asciiname.replace(/[^a-zA-Z ]/g, " ").toLowerCase())
    if (geocodeResult[i].formatted_address.split(',')[0].toLowerCase().includes(place[0].asciiname.replace(/[^a-zA-Z ]/g, " ").toLowerCase())) {
      containsNameIndex = i
      break;
    }
  }


  for (let i = 0; i < geocodeResult.length; i++) {
    //console.log(geocodeResult[i].formatted_address.split(','))
    if (geocodeResult[i].types.includes("locality")) {
      localityIndex = i
    }

    if (geocodeResult[i].types.includes("sublocality")) {
      biggestSublocalityIndex = i
    }
  }

  //default
  let placeIndex = containsNameIndex;

  if (containsNameIndex == undefined) {
    placeIndex = localityIndex
  } else if (localityIndex < containsNameIndex) {
    placeIndex = localityIndex
  }

  //this means there was no containsName and no locality
  if (placeIndex == undefined) {
    placeIndex = biggestSublocalityIndex
  }

  //last resort
  if (placeIndex == undefined) {
    placeIndex = firstPoliticalIndex
  }

  //china specific, they have different structure
  if (place[0]["country code"] == "CN") {
    if (containsNameIndex == undefined) {
      placeIndex = firstPoliticalIndex
    }
  }

  //japan specific
  if (place[0]["country code"] == "JP") {
    if (containsNameIndex == undefined) {
      placeIndex = biggestSublocalityIndex
    }
  }

  //switzerland specific
  if (place[0]["country code"] == "CH") {
    if (containsNameIndex == undefined) {
      placeIndex = biggestSublocalityIndex
    }
  }

  if (placeIndex == undefined) {
    res.send([])
    return;
  }

  console.log("contains name index: ", containsNameIndex)
  console.log("locality index: ", localityIndex)
  console.log(placeIndex)

  const details = await getPlaceDetails(geocodeResult[placeIndex].place_id)
  console.log("Found place: ", geocodeResult[placeIndex].formatted_address)
  console.log(details.geometry.location.lat, ", ", details.geometry.location.lng)
  console.log("===================")

  details.formatted_address = geocodeResult[placeIndex].formatted_address
  details.geonameid = place[0].geonameid
  details.name = geocodeResult[placeIndex].formatted_address.split(',')[0].replace(/[0-9]/g, '')
  details["country code"] = place[0]["country code"]
  res.send(details)
  return;


});

//returns direct url of that photo from google api
app.get('/get_photo_url', async (req, res) => {
  const photoreference = req.query.photoreference

  gmaps
    .placePhoto({
      params: {
        photoreference: photoreference,
        maxwidth: 1600,
        key: process.env.GOOGLE_MAPS_API_KEY
      },
      responseType: "blob"
    })
    .then((photo) => {
      //console.log(photo.request.res.responseUrl)
      res.send(photo.request.res.responseUrl);
      return
    })
    .catch((e) => {
      console.log(e);
    });
});

//returns leaderboard
app.get('/get_leaderboard', async (req, res) => {
  const { data, error } = await supabase.from('leaderboard').select().order('score', { ascending: false }).limit(100)
  res.send(data)
});

//returns the rank in the leaderboard of a given score
//row number when ordered by descending score
app.get('/get_rank_from_leaderboard', async (req, res) => {
  const highscore = req.query.highscore

  const { data, error } = await supabase.from('leaderboard').select().order('score', { ascending: false }).gt('score', parseInt(highscore))
  res.send([data.length])
});

//saves finished game score and data to leaderboard
app.post('/save_score_to_leaderboard', async (req, res) => {
  const reqBody = req.body

  //recomputing score and multis to avoid cheated score posting
  let totalBaseScore = 0
  reqBody.paths.forEach(path => {
    totalBaseScore += generateScore(getDistanceFromLatLonInKm(path[0]["lat"], path[0]["lng"], path[1]["lat"], path[1]["lng"]), reqBody.zonemode, reqBody.gamemode, reqBody.countrycode)
  })

  let multi = getGameMulti(reqBody.zonemode, reqBody.population)
  if (reqBody.gamemode == "country") {
    multi = 1
  }

  try {
    const { data, error } = await supabase.from('leaderboard').insert({
      username: reqBody.username,
      basescore: totalBaseScore,
      multi: multi,
      score: totalBaseScore * multi,
      gamemode: reqBody.gamemode,
      zonemode: reqBody.zonemode,
      countrycode: reqBody.countrycode,
      population: reqBody.population,
      paths: reqBody.paths
    })
    res.send(data)
  } catch (err) {
    res.send(err)
  }

});

//gets the history data of a given user
app.get('/get_history', async (req, res) => {
  const username = req.query.username

  const { data, error } = await supabase.from('history').select().eq('username', username)
  res.send(data)
});

//checks if username already exists
app.get('/username_exists', async (req, res) => {
  const username = req.query.username

  const { data, error } = await supabase.from('profiles').select().eq('username', username)
  res.send(data)
});

//saves history data of a given user
app.post('/save_history', async (req, res) => {
  const username = req.query.username
  const reqBody = req.body

  try {
    const { data, error } = await supabase.from('history').upsert({
      username: username,
      history: reqBody
    })
    res.send(data)
  } catch (err) {
    res.send(err)
  }

});

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at https://localhost:${port}`);
});

//generates the score of a round based on gamemode and distance
function generateScore(distance, zoneMode, gameMode, countryCode) {
  let zoneMaxDistance = {
    "worldwide": 2500,
    "europe": 1500,
    "africa": 2500,
    "americas": 2000,
    "asia/oceania": 2000
  }

  let maxDistance = zoneMaxDistance[zoneMode]
  let maxPointsCutoff = 50

  // calculate maxDistance based on country bounds
  if (gameMode == 'country') {
    const diagonal = getDistanceFromLatLonInKm(bounds[countryCode][1][0], bounds[countryCode][1][1], bounds[countryCode][1][2], bounds[countryCode][1][3])

    maxDistance = diagonal / 4
    maxPointsCutoff = diagonal / 500
  }

  if (distance > maxDistance) {
    return 0
  } else if (distance <= maxPointsCutoff) {
    return 1000
  } else {
    console.log(Math.floor(1000 * (1 - ((distance - maxPointsCutoff) / (maxDistance - maxPointsCutoff))) ** 2))
    return Math.floor(1000 * (1 - ((distance - maxPointsCutoff) / (maxDistance - maxPointsCutoff))) ** 2)
  }
}

//calculates distance from two pairs of coordinates
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2 - lat1);  // deg2rad below
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
    ;
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c; // Distance in km

  return Math.floor(d);
}

function deg2rad(deg) {
  return deg * (Math.PI / 180)
}

//returns the score mutiplier based on gamemode and population
function getGameMulti(zone, population) {
  let zoneMultis = {
    "worldwide": 4,
    "europe": 0,
    "africa": 0,
    "americas": 1,
    "asia/oceania": 2.5
  }
  let popMultis = {
    "500": 5,
    "10000": 3,
    "50000": 2,
    "100000": 1,
    "500000": 0
  }
  return 1 + zoneMultis[zone] + popMultis[population]
}

