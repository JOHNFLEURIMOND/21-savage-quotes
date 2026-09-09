const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

function createRuntime(env, connectionError) {
  const calls = { connections: [], ports: [], errors: [] }
  const app = {
    set() {}, use() {}, get() {}, post() {}, put() {}, delete() {},
    listen(port) { calls.ports.push(port) }
  }
  const express = () => app
  express.static = () => () => {}
  const modules = {
    express,
    'body-parser': { urlencoded() {}, json() {} },
    mongodb: {
      MongoClient: {
        connect(uri, callback) {
          calls.connections.push(uri)
          callback(connectionError, {})
        }
      }
    }
  }
  const context = {
    require(name) { return modules[name] },
    process: { env },
    console: { log() {}, error(message) { calls.errors.push(message) } }
  }
  return { calls, context, run() { vm.runInNewContext(source, context) } }
}

test('missing MONGODB_URI stops before connection or listen', () => {
  const runtime = createRuntime({})
  assert.throws(() => runtime.run(), /MONGODB_URI is required/)
  assert.deepEqual(runtime.calls.connections, [])
  assert.deepEqual(runtime.calls.ports, [])
})

test('configured URI reaches the driver and preserves the default port', () => {
  const uri = 'mongodb://localhost:27017/test'
  const runtime = createRuntime({ MONGODB_URI: uri })
  runtime.run()
  assert.deepEqual(runtime.calls.connections, [uri])
  assert.deepEqual(runtime.calls.ports, [3000])
})

test('connection failure does not log driver details or start listening', () => {
  const runtime = createRuntime(
    { MONGODB_URI: 'mongodb://localhost:27017/test' },
    new Error('sensitive driver details')
  )
  runtime.run()
  assert.deepEqual(runtime.calls.errors, ['MongoDB connection failed'])
  assert.deepEqual(runtime.calls.ports, [])
  assert.equal(runtime.context.process.exitCode, 1)
})

test('configured port is preserved', () => {
  const runtime = createRuntime({ MONGODB_URI: 'mongodb://localhost:27017/test', PORT: '8080' })
  runtime.run()
  assert.deepEqual(runtime.calls.ports, ['8080'])
})
