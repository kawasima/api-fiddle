const { parseApiSpec, readSpec } = require('@json-spec/openapi/src/core');
const s = require('@json-spec/core');
const gen = require('@json-spec/core/gen');
const express = require('express');
const bodyParser = require('body-parser');
const Negotiator = require('negotiator').Negotiator;
const path = require('path');

const router = new express.Router();

function toExpressPath(path) {
  return path.replace(/\{([^\}]+)\}/, ':$1');
}

const methodStatusMap = {
  'get': ['200'],
  'post': ['201', '200'],
  'put': ['204', '201', '200'],
  'patch': ['204', '201', '200'],
  'delete': ['204', '200']
};

function Response() {
  this.headers = {};
  this.statusCode = 200;
  this.body = null;
}
Response.prototype.set = function(name, value) {
  this.headers[name] = value;
}
Response.prototype.status = function(code) {
  this.statusCode = code;
  return this;
}
Response.prototype.send = function(body) {
  this.body = body;
}
Response.prototype.json = function(json) {
  this.body = json;
}


function callback({ method, path, specs}) {
  return {
    method,
    path,
    fn: (req, res) => {
      let contentType = req.contentType || 'application/json';
      const negotiator = Negotiator(req);

      // Request
      const requestSpec = (specs.request || {})[contentType];
      if (requestSpec && !s.isValid(requestSpec, req.body)) {
        const mediaType = negotiator.mediaType(Object.keys(specs.response['400'] || {}));
        res.set('content-type', mediaType);
        const malformedSpec = (specs.response['400'] || {})[mediaType];
        res.status(400);
        console.log(s.explain(requestSpec, req.body));

        if (malformedSpec) {
          res.send(gen.generate(s.gen(malformedSpec)));
          return;
        } else {
          res.send();
          return;
        }
      }

      // Response
      const status = (methodStatusMap[method] || [])
            .find(status => specs.response[status])

      if (!status || !specs.response[status]) {
        res.sendStatus(methodStatusMap[method][0]);
      } else {
        const mediaType = negotiator.mediaType(Object.keys(specs.response[status] || {}));
        const spec = specs.response[status][mediaType]
              || Object.values(specs.response[status]).find(x => x)

        res.status(status);
        if (typeof(spec) === 'string') {
          res.send();
        } else {
          res.set('Content-Type', mediaType);
          res.send(gen.generate(s.gen(spec)));
        }
      }
    }
  };
}


async function loadSpec(openapi) {
  const jsonSpecs = {}; // TODO
  const api = await parseApiSpec(openapi);
  const handlers = await readSpec(api, jsonSpecs, callback);
  handlers.forEach(({method, path, fn}) => {
    router[method].call(router, toExpressPath(path), fn)
  });
}

process.on('message', command => {
  switch(command.type) {
  case 'LOAD_SPEC':
    router.stack.length = 0; // Clear router
    loadSpec(command.openapi);
    break;
  case 'REQUEST':
    const res = new Response();
    router.handle(command.req, res, err => {
      res.status(404);
      res.body = null;
    });
    process.send({
      requestId: command.requestId,
      status: res.statusCode,
      headers: res.headers,
      body: res.body
    });
    break;
  case 'KILL':
    process.exit(0);
  }
});
