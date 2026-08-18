import { NativeModules } from 'react-native'

import { captureMessage, init, setUser } from '@inkronik/react-native'

init({
    collectorUrl: 'http://localhost:4318/mobile',
    projectId: 'compatibility-fixture',
    publicIngestKey: 'public_compatibility_fixture',
})
setUser({ id: 'compatibility-user' })
captureMessage({ message: `Native module: ${String(NativeModules.Inkronik !== undefined)}` })
