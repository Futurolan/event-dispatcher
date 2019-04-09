const { initSocket } = require('./src/socket')
const { startTwitchCrawler } = require('./src/twitchCrawler')
const { startYoutubeCrawler } = require('./src/youtubeCrawler')

process.env.BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080'
process.env.PORT = process.env.PORT || 8000

initSocket()

initTwitchCrawler()
initYoutubeCrawler()

function initTwitchCrawler () {
  startTwitchCrawler().catch((err) => {
    console.error(err)
  }).finally(() => {
    console.log('Wait 5sec before next run')
    setTimeout(initTwitchCrawler, 5000)
  })
}

function initYoutubeCrawler () {
  startYoutubeCrawler().catch((err) => {
    console.error(err)
  }).finally(() => {
    console.log('Wait 60sec before next run')
    setTimeout(initYoutubeCrawler, 60000)
  })
}
