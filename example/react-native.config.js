'use strict'

const path = require('node:path')
const { configureProjects } = require('react-native-test-app')

module.exports = {
    project: configureProjects({
        android: { sourceDir: 'android' },
        ios: { automaticPodsInstallation: true, sourceDir: 'ios' },
    }),
    dependencies: {
        '@inkronik/native-crash-harness': {
            root: path.resolve(__dirname, '../fixtures/native-crash-harness'),
        },
        '@inkronik/react-native': {
            root: path.resolve(__dirname, '..'),
            platforms: { android: {}, ios: {} },
        },
    },
}
