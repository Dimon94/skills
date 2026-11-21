const stopStatus = require('./status.js');
const stoppedResults = require('./results.js');

exports.stop = turn => ({ status: stopStatus(turn), results: stoppedResults(turn) });
