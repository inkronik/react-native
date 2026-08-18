'use strict'

const { AppRegistry } = require('react-native')
const App = require('../fixtures/native-crash-harness/App').default
const { name } = require('./app.json')

AppRegistry.registerComponent(name, () => App)
