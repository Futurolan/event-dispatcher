const { log } = require('./utils')
const fetch = require('node-fetch')

const twitchApiBaseUrl = 'https://api.twitch.tv/helix'
const twitchAuthApiBaseUrl = 'https://id.twitch.tv/oauth2'
const token = { access_token: '', expire: 0 }

let editionStreams = {}
let streamsList = {}

exports.startTwitchCrawler = async function () {
  log('twitch', 'Starting Twitch crawler !')

  // Clear variables
  editionStreams = {}
  streamsList = {}

  // Get token for twith auth
  if (token.expire < new Date().getTime() - (3600 * 1000)) {
    log('twitch', 'Getting a token for twitch!')

    const resToken = await fetch(`${twitchAuthApiBaseUrl}/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST', timeout: 10000 })
    const jsonToken = await resToken.json()

    token.access_token = jsonToken.access_token
    token.expire = new Date().getTime() + (jsonToken.expires_in * 1000)
  }

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

  const res = await fetch(`${process.env.BACKEND_API_URL}/graphql?query=${encodeURI(query)}`, { timeout: 10000 })
  const json = await res.json()

  for (let index in json.data.nodeQuery.nodes) {
    const edition = json.data.nodeQuery.nodes[index]
    await getEditionStreamsList(edition.nid, edition.title)
  }

  generateStreamsList()
  if (await getInfoFromTwitch()) {
    populateEditionStreams()
    global.editionStreams = JSON.parse(JSON.stringify(editionStreams))
    dispatchToSocket()
  }
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

  const res = await fetch(`${process.env.BACKEND_API_URL}/graphql?query=${encodeURI(query)}`, { timeout: 10000 })
  const json = await res.json()

  for (let index in json.data.nodeQuery.nodes) {
    const streamsList = json.data.nodeQuery.nodes[index]
    editionStreams[editionNid] = {}
    for (let indexStreamList in streamsList) {
      const streams = streamsList[indexStreamList]

      log('twitch', `Found ${streams.length} stream(s) for lan ${editionTitle} (nid=${editionNid})`)

      for (let indexStreams in streams) {
        const stream = streams[indexStreams].stream

        editionStreams[editionNid][stream.id] = { front: stream.front }
      }
    }
  }
}

function generateStreamsList () {
  for (let editionNid in editionStreams) {
    const streams = editionStreams[editionNid]
    for (let streamId in streams) {
      streamsList[streamId] = { online: false }
    }
  }
}

async function getInfoFromTwitch () {
  for (let streamId in streamsList) {
    // Get the offline image
    log('twitch', `Getting user info for ${streamId}`)
    const resUser = await fetch(`${twitchApiBaseUrl}/users?login=${streamId}`, { headers: { Authorization: `Bearer ${token.access_token}` }, timeout: 10000 })
    const jsonUser = await resUser.json()

    if (jsonUser.error) {
      log('twitch', `[Error] Fetching user info ${jsonUser.error}`)
      return false
    }
    for (let index in jsonUser.data) {
      const user = jsonUser.data[index]
      streamsList[streamId]['offline_image_url'] = user.offline_image_url
      streamsList[streamId]['display_name'] = user.display_name
      streamsList[streamId]['id'] = user.id
    }

    // Get the others informations
    const resStream = await fetch(`${twitchApiBaseUrl}/streams?user_login=${streamId}`, { headers: { Authorization: `Bearer ${token.access_token}` }, timeout: 10000 })
    const jsonStream = await resStream.json()

    if (jsonStream.error) {
      log('twitch', `[Error] fetching stream info ${jsonStream.error}`)
      return false
    }
    for (let index in jsonStream.data) {
      const stream = jsonStream.data[index]
      streamsList[streamId]['online'] = true
      streamsList[streamId]['status'] = stream.title
      streamsList[streamId]['viewer_count'] = stream.viewer_count
    }
  }
  return true
}

function populateEditionStreams () {
  for (let editionNid in editionStreams) {
    const streams = editionStreams[editionNid]
    for (let streamId in streams) {
      if (streamsList[streamId].id) {
        editionStreams[editionNid][streamId] = { ...streamsList[streamId], ...editionStreams[editionNid][streamId] }
      } else {
        log('twitch', `Remove stream ${streamId} from list, twitch doesn't know it`)
        delete editionStreams[editionNid][streamId]
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
