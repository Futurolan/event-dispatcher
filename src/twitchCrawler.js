const { log } = require('./utils')
const fetch = require('node-fetch')

const twitchApiBaseUrl = 'https://api.twitch.tv/helix'

global.editionStreams = {}
let streamsList = {}

exports.startTwitchCrawler = async function () {
  log('twitch', 'Starting Twitch crawler !')

  // Clear variables
  global.editionStreams = {}
  streamsList = {}

  // Get editions from backend
  const query = `
  {
    nodeQuery(filter: {conditions: [{field: "type", value: ["edition"], operator: EQUAL}, {field: "status", value: ["1"]}, {field: "field_edition_live_mode_active",value:["1"]}]}, limit: 9999) {
      nodes:entities {
       ... on NodeEdition{
        nid
        title
        }
      }
    }
  }`

  const res = await fetch(`${process.env.BACKEND_API_URL}/graphql?query=${encodeURI(query)}`)
  const json = await res.json()

  for (let index in json.data.nodeQuery.nodes) {
    const edition = json.data.nodeQuery.nodes[index]
    await getEditionStreamsList(edition.nid, edition.title)
  }

  generateStreamsList()
  await getInfoFromTwitch()
  populateEditionStreams()
  dispatchToSocket()
}

async function getEditionStreamsList (editionNid, editionTitle) {
  log('twitch', `Get StreamsList for ${editionTitle} (nid:${editionNid})`)
  const query = `
  {
    nodeQuery(filter: {conditions: [{field: "type", value: ["streamslist"], operator: EQUAL}, {field: "status", value: ["1"]}, {field: "field_streamslist_edition",value:["${editionNid}"]}]}, limit: 1) {
      nodes:entities {
       ... on NodeStreamslist{
          streamslist:fieldStreamslist {
            stream:entity {
              ... on ParagraphStreamTwitch{
                id:fieldStreamId
                front:fieldDisplayFront
              }
            }
          }
        }
      }
    }
  }`

  const res = await fetch(`${process.env.BACKEND_API_URL}/graphql?query=${encodeURI(query)}`)
  const json = await res.json()

  for (let index in json.data.nodeQuery.nodes) {
    const streamsList = json.data.nodeQuery.nodes[index]
    global.editionStreams[editionNid] = {}
    for (let indexStreamList in streamsList) {
      const streams = streamsList[indexStreamList]

      log('twitch', `Found ${streams.length} stream(s) for lan ${editionTitle} (nid=${editionNid})`)

      for (let indexStreams in streams) {
        const stream = streams[indexStreams].stream

        global.editionStreams[editionNid][stream.id] = { front: stream.front }
      }
    }
  }
}

function generateStreamsList () {
  for (let editionNid in global.editionStreams) {
    const streams = global.editionStreams[editionNid]
    for (let streamId in streams) {
      streamsList[streamId] = { online: false }
    }
  }
}

async function getInfoFromTwitch () {
  let logins = []
  for (let key in streamsList) {
    logins.push(key)
  }

  // Get the offline image
  const resUser = await fetch(`${twitchApiBaseUrl}/users?login=${logins.join('&login=')}`, { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID } })
  const jsonUser = await resUser.json()

  for (let index in jsonUser.data) {
    const user = jsonUser.data[index]
    console.log(user)
    if (streamsList[user.login] === undefined) {
      log('twitch', `Warning stream ${user.login} is not in streamsList (should not append!!!)`)
      continue
    }

    streamsList[user.login]['offline_image_url'] = user.offline_image_url
    streamsList[user.login]['display_name'] = user.display_name
    streamsList[user.login]['id'] = user.id
  }

  // Get the others informations
  const resStream = await fetch(`${twitchApiBaseUrl}/streams?user_login=${logins.join('&user_login=')}`, { headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID } })
  const jsonStream = await resStream.json()

  console.log(jsonStream)
  for (let index in jsonStream.data) {
    const stream = jsonStream.data[index]
    if (streamsList[stream.user_name] === undefined) {
      log('twitch', `Warning stream ${stream.user_name} is not in streamsList (should not append!!!)`)
      continue
    }

    streamsList[stream.user_name]['online'] = true
    streamsList[stream.user_name]['title'] = stream.title
    streamsList[stream.user_name]['viewer_count'] = stream.viewer_count
  }
}

function populateEditionStreams () {
  for (let editionNid in global.editionStreams) {
    const streams = global.editionStreams[editionNid]
    for (let streamId in streams) {
      if (streamsList[streamId].id) {
        global.editionStreams[editionNid][streamId] = { ...streamsList[streamId], ...global.editionStreams[editionNid][streamId] }
      } else {
        log('twitch', `Remove stream ${streamId} from list, twitch doesn't know it`)
        delete global.editionStreams[editionNid][streamId]
      }
    }
  }
}

function dispatchToSocket () {
  for (let editionNid in global.editionStreams) {
    log('twitch', `Emit update for edition ${editionNid}`)
    const streams = global.editionStreams[editionNid]
    global.io.sockets.emit(`streamsTwitch${editionNid}`, streams)
  }
}
