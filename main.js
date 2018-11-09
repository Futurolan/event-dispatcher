const { initSocket } = require('./src/socket')
const { startTwitchCrawler } = require('./src/twitchCrawler')
const { startToornamentCrawler } = require('./src/toornamentCrawler')

process.env.BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080'
process.env.PORT = process.env.PORT || 8000

initSocket()

init()
function init () {
  startTwitchCrawler().catch((err) => {
    console.error(err)
  }).finally(() => {
    console.log('Wait 20sec before next run')
    setTimeout(init, 4000)
  })
  startToornamentCrawler()
}
