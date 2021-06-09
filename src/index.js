const app = require('./app');
const config = require('./config/config');
const logger = require('./config/logger');
const routes = require('./routes');

const server = app.listen(config.port, () => {
  logger.info(`Listening to port ${config.port}`);
});

app.use('/', routes);

module.exports = app;
