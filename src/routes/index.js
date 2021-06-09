const express = require('express');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { fork } = require('child_process');
const tmp = require('tmp');
const SwaggerParser = require("@apidevtools/swagger-parser");
const logger = require('../config/logger');

const router = express.Router();
const mockServers = {};
const requests = {}


router.route('/')
  .get((req, res) => {
    res.sendFile(path.join(__dirname, '../../assets/html/index.html'));
  });

router.route('/new')
  .post((req, res) => {
    const fiddleId = nanoid(4);
    mockServers[fiddleId] = fork(path.join(__dirname, './mock_server.js'));
    mockServers[fiddleId].on('message', res => {
      const response = requests[res.requestId];
      delete requests[res.requestId];
      response.status(res.status);
      response.json(res.body);
    });
    mockServers[fiddleId].on('exit', (code, signal) => {
      delete mockServers[fiddleId]
      logger.info(`Terminated the [${fiddleId}] API`);
    });
    setTimeout(() => mockServers[fiddleId].send({type: 'KILL'}), 1000 * 60 * 120);
    res.json({
      id: fiddleId
    });
  });

router.route('/:fiddleId([0-9A-Za-z\-_]{4})/api(/*)?')
  .all((req, res) => {
    const requestId = nanoid(30);
    requests[requestId] = res;
    const baseUrl = "/" + req.params['fiddleId'] + '/api';
    mockServers[req.params['fiddleId']].send({
      type: 'REQUEST',
      req: {
        headers: req.headers,
        query: req.query,
        url: req.url.replace(baseUrl, ""),
        baseUrl,
        path: req.path.replace(baseUrl, ""),
        params: req.params,
        body: req.body,
        method: req.method,
        cookies: req.cookies,
      },
      requestId,
    });
  });


router.route('/:fiddleId([0-9A-Za-z\-_]{4}$)')
  .get((req, res) => {
    if (!(req.params['fiddleId'] in mockServers)) {
      res.sendFile(path.join(__dirname, '../../assets/html/gone.html'));
    } else {
      res.sendFile(path.join(__dirname, '../../assets/html/fiddle.html'));
    }
  })
  .put((req, res, next) => {
    const openapi = req.body.openapi || "";
    tmp.file(async (err, path, fd, cleanup) => {
      if (err) {
        res.status(500);
        res.json({ detail: err });
        return;
      }
      try {
        fs.writeSync(fd, openapi);
        const api = await SwaggerParser.validate(path);
        mockServers[req.params['fiddleId']].send({
          type: 'LOAD_SPEC',
          openapi: api,
        });
        res.status(204);
        res.send();
      } catch(err) {
        res.status(400);
        res.json({ detail: err });
      } finally {
        cleanup();
      }
    });
  });

module.exports = router;
