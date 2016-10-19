'use strict'

const fs      = require('fs')
const mkdirp  = require('mkdirp')
const path    = require('path')
const ipfsd   = require('ipfsd-ctl')
const IpfsApi = require('ipfs-api') // go-ipfs
// const IPFS    = require('ipfs') // TODO: js-ipfs
const Logger  = require('logplease')
const logger = Logger.create("ipfs-daemon")

Logger.setLogLevel(process.env.LOG ? process.env.LOG.toUpperCase() : 'ERROR')

/* Usage:
    const IpfsDaemon = require('ipfs-daemon')
    IpfsDaemon(options).then((res) => {
      // res.ipfs - an IPFS API instance (js-ipfs and js-ipfs-api)
      // res.daemon - IPFS daemon (ipfsd-ctl/node)
      // res.Addresses - IPFS daemon's API, Gateway and Swarm addresses
    })
*/

module.exports = (options) => { 
  // Default options
  let opts = {
    // Location of IPFS repository
    IpfsDataDir: process.env.IPFS_PATH || './ipfs',
    // Location to write log files to
    LogDirectory: './',
    // Bind the IPFS daemon to a random port by default
    Addresses: {
      API: '/ip4/127.0.0.1/tcp/5001',
      Swarm: ['/ip4/0.0.0.0/tcp/4001'],
      Gateway: '/ip4/0.0.0.0/tcp/8080'
    },
    // Flags to pass to the IPFS daemon
    Flags: ['--enable-pubsub-experiment'] // Enable Pubsub by default
  }

  // Override default options with user options
  Object.assign(opts, options)

  // Make sure we have the app data directory
  if (!fs.existsSync(opts.IpfsDataDir))
    mkdirp.sync(opts.IpfsDataDir)

  // Setup logfiles
  Logger.setLogfile(path.join(opts.LogDirectory, '/ipfs-daemon.log'))

  // State
  let ipfsDaemon
  
  // Handle shutdown gracefully
  const shutdown = () => {
    logger.debug("Shutting down...")
    ipfsDaemon.stopDaemon()
    setTimeout(() => {
      logger.debug("All done!")
      process.exit(0)
    }, 1000)
  }

  // Handle shutdown signals
  process.on('SIGINT', () => shutdown)
  process.on('SIGTERM', () => shutdown)

  // Log errors
  process.on('uncaughtException', (error) => {
    // Skip 'ctrl-c' error and shutdown gracefully
    const match = String(error).match(/non-zero exit code 255/)
    if(match)
      shutdown()
    else
      logger.error(error)
  })

  // Start
  return new Promise((resolve, reject) => {
    ipfsd.local(opts.IpfsDataDir, opts, (err, node) => {
      if(err) throw err
      ipfsDaemon = node

      logger.debug("Initializing IPFS daemon")
      logger.debug(`Using IPFS repo at '${node.path}'`)

      ipfsDaemon.init({ directory: opts.IpfsDataDir }, (err, node) => {
        if (!err) {
          logger.debug("Starting IPFS daemon")
          ipfsDaemon.startDaemon(opts.Flags, (err, ipfs) => {
            if (err) 
              return reject(err)

            const ipfsInstance = IpfsApi(ipfs.apiHost, ipfs.apiPort)
            const gatewayAddress = node.gatewayAddr ? node.gatewayAddr + '/ipfs/' : 'localhost:8080/ipfs/'

            logger.debug("IPFS daemon started at", ipfs.apiHost, ipfs.apiPort)
            logger.debug("Gateway at", gatewayAddress)

            resolve({ 
              ipfs: ipfsInstance,
              daemon: ipfsDaemon,
              Addresses: {
                Gateway: gatewayAddress 
              }
            })
          })
        } else {
          // Check if the IPFS repo is an incompatible one
          const migrationNeeded = String(err).match('ipfs repo needs migration')

          if (migrationNeeded) {
            let errStr = `Error initializing IPFS daemon: '${migrationNeeded[0]}'\n`
            errStr += `Tried to init IPFS repo at '${opts.IpfsDataDir}', but failed.\n`
            errStr += `Use $IPFS_PATH to specify another repo path, eg. 'export IPFS_PATH=/tmp/orbit-floodsub'.`

            errStr.split('\n')
              .forEach((e) => logger.error(e))

            reject(errStr)
          }
        }
      })
    })
  })
}
