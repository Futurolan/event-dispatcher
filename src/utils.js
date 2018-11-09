
exports.log = function (type, message) {
  if (type === 'twitch') {
    console.log(`[Twitch] ${message}`)
  } else if (type === 'toornament') {
    console.log(`[Toornament] ${message}`)
  } else {
    console.log(message)
  }
}
