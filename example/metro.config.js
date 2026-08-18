'use strict'

const path = require('node:path')
const { getDefaultConfig } = require('@react-native/metro-config')
const { withMetroConfig } = require('react-native-monorepo-config')

const root = path.resolve(__dirname, '..')

module.exports = withMetroConfig(getDefaultConfig(__dirname), {
    root,
    dirname: __dirname,
})
