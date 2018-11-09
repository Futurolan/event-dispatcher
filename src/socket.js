const io = require('socket.io')()
global.io = io
global.editionStreams = {}

let count = 0
exports.initSocket = function () {
  io.on('connection', (client) => {
    console.log(`Client ${count} with id:${client.id} connected`)
    count++
    // Dispatch streams to new client directly
    for (let editionNid in global.editionStreams) {
      const streams = global.editionStreams[editionNid]
      io.emit(`streamsTwitch${editionNid}`, streams)
    }
    client.on('disconnect', () => {
      count--
      console.log(`${client.id} disconnected`)
    })
  })

  const port = process.env.PORT
  io.listen(port)
  console.log('Socket.io listening on port', port)
}
