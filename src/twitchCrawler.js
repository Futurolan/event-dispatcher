const fetch = require('node-fetch')

const twitchApiBaseUrl = 'https://api.twitch.tv/helix'
const twitchAuthApiBaseUrl = 'https://id.twitch.tv/oauth2'

let twitchStreams

exports.startTwitchCrawler = async function () {
  console.log('[twitch] Starting twitch crawler !')

  twitchStreams = {}

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

  console.log(`[twitch] Found ${json.data.nodeQuery.nodes.length} active edition`)

  for (let index in json.data.nodeQuery.nodes) {
    const edition = json.data.nodeQuery.nodes[index]
    await getEditionStreamsList(edition.nid, edition.title)
  }

  await getInfoFromTwitch()

  dispatchToSocket()
}

async function getEditionStreamsList (editionNid, editionTitle) {
  console.log(`[twitch] Get StreamsList for ${editionTitle} (nid:${editionNid})`)
  const query = `
  {
    nodeQuery(filter: {conditions: [{field: "type", value: ["streamslist"], operator: EQUAL}, {field: "status", value: ["1"]}, {field: "field_streamslist_edition",value:["${editionNid}"]}]}, limit: 1) {
      nodes:entities {
       ... on NodeStreamslist{
          streamslist:fieldStreamslist {
            stream:entity {
              ... on ParagraphStreamTwitch{
                id:fieldStreamId
                type {
                  id:targetId
                }
              }
              ... on ParagraphStreamYoutube{
                id:fieldStreamId
                type {
                  id:targetId
                }
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
    const nodeStreamsList = json.data.nodeQuery.nodes[index]
    for (let indexNodeStreamsList in nodeStreamsList) {
      const streams = nodeStreamsList[indexNodeStreamsList]
      for (let indexStreams in streams) {
        const stream = streams[indexStreams].stream
        if (stream.type.id === 'stream_twitch') { twitchStreams[stream.id] = { online: false } }
      }
    }
  }
}

async function getInfoFromTwitch () {
  const twitchToken = { access_token: '', expire: 0 }

  // Get token for twith auth
  if (twitchToken.expire < new Date().getTime() - (3600 * 1000)) {
    console.log('[twitch] Getting a token for twitch!')

    const resToken = await fetch(`${twitchAuthApiBaseUrl}/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST', timeout: 10000 })
    const jsonToken = await resToken.json()

    twitchToken.access_token = jsonToken.access_token
    twitchToken.expire = new Date().getTime() + (jsonToken.expires_in * 1000)
  }

  for (let streamId in twitchStreams) {
    // Get the offline image
    console.log(`[twitch] Getting info for twitch ${streamId}`)
    const resUser = await fetch(`${twitchApiBaseUrl}/users?login=${streamId}`, { headers: { "client-id": `${process.env.TWITCH_CLIENT_ID}`, Authorization: `Bearer ${twitchToken.access_token}` }, timeout: 10000 })
    const jsonUser = await resUser.json()


    if (jsonUser.error) {
      console.error(`[twitch] Error fetching twitch user info ${jsonUser.error}`)
      continue
    }

    if(jsonUser.data.length === 0){
      console.error(`[twitch] Cannot found data for user ${streamId}`)
      continue
    }

    for (let index in jsonUser.data) {
      const user = jsonUser.data[index]
      twitchStreams[streamId]['offline_image_url'] = user.offline_image_url
      twitchStreams[streamId]['display_name'] = user.display_name
      twitchStreams[streamId]['id'] = user.id
    }

    // Get the others informations
    const resStream = await fetch(`${twitchApiBaseUrl}/streams?user_login=${streamId}`, { headers: { "client-id": `${process.env.TWITCH_CLIENT_ID}`, Authorization: `Bearer ${twitchToken.access_token}` }, timeout: 10000 })
    const jsonStream = await resStream.json()

    if (jsonStream.error) {
      console.error(`[twitch] Error fetching twitch stream info ${jsonStream.error}`)
      continue
    }
    for (let index in jsonStream.data) {
      const stream = jsonStream.data[index]
      twitchStreams[streamId]['online'] = true
      twitchStreams[streamId]['status'] = stream.title
      twitchStreams[streamId]['viewer_count'] = stream.viewer_count
    }

    // Check if stream is hosted
    if (twitchStreams[streamId]['online'] === false) {
      console.error(`[twitch] Stream is offline checking if he has hosted stream`)

      const hostStream = await fetch(`https://tmi.twitch.tv/hosts?include_logins=1&host=${twitchStreams[streamId]['id']}`, {
        timeout: 10000
      })
      const jsonHostStream = await hostStream.json()

      if (jsonHostStream.error) {
        console.error(`[twitch] Error fetching twitch hosted info ${jsonHostStream.error}`)
        continue
      }
      let hosted = false;
      for (let index in jsonHostStream.hosts) {
        const host = jsonHostStream.hosts[index]
        if(host.target_id) {
          twitchStreams[streamId]['id'] = host.target_id
          hosted = true
        }
      }


      if(hosted){
        console.error(`[twitch] Hosted stream found, getting info`)

        // Get the others informations for the host
        const resStream2 = await fetch(`${twitchApiBaseUrl}/streams?user_id=${twitchStreams[streamId]['id']}`, { headers: { "client-id": `${process.env.TWITCH_CLIENT_ID}`, Authorization: `Bearer ${twitchToken.access_token}` }, timeout: 10000 })
        const jsonStream2 = await resStream2.json()

        if (jsonStream2.error) {
          console.error(`[twitch] Error fetching twitch stream host info ${jsonStream2.error}`)
          continue
        }
        for (let index in jsonStream2.data) {
          const stream = jsonStream2.data[index]
          twitchStreams[streamId]['online'] = true
          twitchStreams[streamId]['status'] = stream.title
          twitchStreams[streamId]['viewer_count'] = stream.viewer_count
        }
      }

    }
  }
}

function dispatchToSocket () {
  console.log(`[twitch] Emit twitch streams update`)
  global.twitchStreams = JSON.parse(JSON.stringify(twitchStreams))
  global.io.sockets.emit(`twitchStreams`, twitchStreams)
}
