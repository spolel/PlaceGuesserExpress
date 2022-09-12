import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import cors from 'cors';


import { createClient } from '@supabase/supabase-js'

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

app.get('/', (req, res) => {
  res.send('Express + TypeScript Server');
});

app.get('/test', async (req, res) => {
  const { data, error } = await supabase.from('random_places').select().limit(1)
  res.send(data)
});

app.get('/get_random_place', async (req, res) => {
  const pop = req.query.pop
  const zone = req.query.zone

  if (zone == 'worldwide') {
    const { data, error } = await supabase.from('random_places').select().gte('population', parseInt(pop)).limit(1)
    res.send(data)
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
    res.send(data)
  }

});

app.get('/get_leaderboard', async (req, res) => {
  const { data, error } = await supabase.from('leaderboard').select().order('score', { ascending: false })
  // data.forEach(async x => {
  //   const { data, error } = await supabase.from('leaderboard').upsert({
  //     id: x.id,
  //     paths: JSON.parse(x.paths)
  //   })
  // })
  res.send(data)
});

app.get('/get_rank_from_leaderboard', async (req, res) => {
  const highscore = req.query.highscore

  const { data, error } = await supabase.from('leaderboard').select().order('score', { ascending: false }).gte('score', parseInt(highscore))
  res.send([data.length])
});

app.get('/get_history', async (req, res) => {
  const username = req.query.username

  const { data, error } = await supabase.from('history').select().eq('username', username)
  res.send(data)
});

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

app.post('/save_score_to_leaderboard', async (req, res) => {
  const reqBody = req.body

  //recomputing score and multis to avoid cheated score posting
  let totalBaseScore = 0
  reqBody.paths.forEach(path => {
    totalBaseScore += generateScore(getDistanceFromLatLonInKm(path[0]["lat"], path[0]["lng"], path[1]["lat"], path[1]["lng"]), reqBody.gamemode)
  })
  let multi = getGameMulti(reqBody.gamemode, reqBody.population)


  try {
    const { data, error } = await supabase.from('leaderboard').insert({
      username: reqBody.username,
      basescore: totalBaseScore,
      multi: multi,
      score: totalBaseScore * multi,
      gamemode: reqBody.gamemode,
      population: reqBody.population,
      paths: reqBody.paths
    })
    res.send(data)
  } catch (err) {
    res.send(err)
  }

});

app.listen(port, () => {
  console.log(`⚡️[server]: Server is running at https://localhost:${port}`);
});

function generateScore(distance, gamemode) {
  if (gamemode == 'europe') {
    if (distance > 1500) {
      return 0
    } else if (distance <= 50) {
      return 1000
    } else {
      return Math.floor(1000 * (1 - ((distance - 50) / 1450)) ** 2)
    }
  } else if (gamemode == 'americas') {
    if (distance > 2000) {
      return 0
    } else if (distance <= 50) {
      return 1000
    } else {
      return Math.floor(1000 * (1 - ((distance - 50) / 1950)) ** 2)
    }
  } else if (gamemode == 'africa') {
    if (distance > 2500) {
      return 0
    } else if (distance <= 50) {
      return 1000
    } else {
      return Math.floor(1000 * (1 - ((distance - 50) / 2450)) ** 2)
    }
  } else if (gamemode == 'asia/oceania') {
    if (distance > 2000) {
      return 0
    } else if (distance <= 50) {
      return 1000
    } else {
      return Math.floor(1000 * (1 - ((distance - 50) / 1950)) ** 2)
    }
  } else {
    if (distance > 2500) {
      return 0
    } else if (distance <= 50) {
      return 1000
    } else {
      return Math.floor(1000 * (1 - ((distance - 50) / 2450)) ** 2)
    }
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

