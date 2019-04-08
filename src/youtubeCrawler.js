const fetch = require('node-fetch')

let youtubeStreams

exports.startYoutubeCrawler = async function () {
  console.log('[youtube] Starting youtube crawler !')

  youtubeStreams = {}

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

  console.log(`[youtube] Found ${json.data.nodeQuery.nodes.length} active edition`)

  for (let index in json.data.nodeQuery.nodes) {
    const edition = json.data.nodeQuery.nodes[index]
    await getEditionStreamsList(edition.nid, edition.title)
  }

  await getInfoFromYoutube()

  dispatchToSocket()
}

async function getEditionStreamsList (editionNid, editionTitle) {
  console.log(`[youtube] Get StreamsList for ${editionTitle} (nid:${editionNid})`)
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
        if (stream.type.id === 'stream_youtube') { youtubeStreams[stream.id] = { online: false } }
      }
    }
  }
}

async function getInfoFromYoutube () {
  const youtubeStreamsKeys = Object.keys(youtubeStreams)

  console.log(`[youtube] Getting info for streams : ${youtubeStreamsKeys.join(',')}`)

  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${youtubeStreamsKeys.join(',')}&key=${process.env.YOUTUBE_KEY}`, { timeout: 10000 })
  const json = await res.json()
  if (json.error) {
    console.log(`[youtube] Fetching video info: ${json.error.message}`)
  }
  for (let videoIndex in json.items) {
    const video = json.items[videoIndex]
    youtubeStreams[video.id]['id'] = video.id
    youtubeStreams[video.id]['status'] = video.snippet.title
    youtubeStreams[video.id]['display_name'] = video.snippet.channelTitle

    if (video.liveStreamingDetails.concurrentViewers) {
      youtubeStreams[video.id]['online'] = true
      youtubeStreams[video.id]['viewer_count'] = video.liveStreamingDetails.concurrentViewers
    }
  }
}

function dispatchToSocket () {
  console.log(`[youtube] Emit youtube streams update`)
  global.youtubeStreams = JSON.parse(JSON.stringify(youtubeStreams))
  global.io.sockets.emit(`youtubeStreams`, youtubeStreams)
}
