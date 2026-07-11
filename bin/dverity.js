#!/usr/bin/env node

const { main } = require('./dverity-cli');

process.exitCode = main();
