'use strict'

module.exports = {
    dependency: {
        platforms: {
            android: {
                packageImportPath: 'import com.inkronik.crashfixture.InkronikCrashFixturePackage;',
                packageInstance: 'new InkronikCrashFixturePackage()',
                sourceDir: 'android',
            },
        },
    },
}
