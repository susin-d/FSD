const routes = require("./routes");

function attachMessageSocket(io) {
  return routes.attachMessageSocket(io);
}

module.exports = { attachMessageSocket };
