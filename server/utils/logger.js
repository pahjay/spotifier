const winston = require('winston');
const { format } = require('logform');
const config = require('../../config-public');
require('winston-daily-rotate-file');

// formats
const fileJsonFormat = format.combine(
  format.timestamp(),
  winston.format.json()
)

const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({
    format: config.log.timestampPattern  
  }),
  winston.format.simple(),
  format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
)

const humanFormat = format.combine(
    format.timestamp({
        format: config.log.timestampPattern
    }),
    winston.format.simple(),
    format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
)

// transports
const jsonTransport = getRotateTransport('json/spotifier');
const humanTransport = getRotateTransport('human/spotifier');

// loggers
const logger = winston.createLogger({
  level: config.log.fileLevel,
  format: fileJsonFormat,
  transports: [
    jsonTransport
  ]
});

logger.add(winston.createLogger({
    level: config.log.fileLevel,
    format: humanFormat,
    transports: [
        humanTransport
    ]
}))

logger.add(new winston.transports.Console({
  level: config.log.consoleLevel,
  format: consoleFormat,
  prettyPrint: true,
  handleExceptions: true
}));

/**
 * Get a daily rotate transport
 * @param {String} filename: root name of log file
 * TODO: handle windows
 */
function getRotateTransport(filename) {
  return new (winston.transports.DailyRotateFile)({
    filename: '/var/log/spotifier/' + filename + '-%DATE%.log',
    //filename: path.join(__dirname, '../log/' + filename + '-%DATE%.log'),
    datePattern: config.log.datePattern,
    zippedArchive: true,
    maxSize: config.log.maxSize,
    maxFiles: config.log.maxFiles
  });
} 

module.exports = logger;