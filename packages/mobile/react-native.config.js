/**
 * Project-level React Native autolinking overrides.
 *
 * Why the `expo` override exists:
 * `expo/react-native.config.js` opens with `require('expo-modules-autolinking/exports')`,
 * and expo-modules-autolinking evaluates that file through `require-from-string` using the
 * *symlinked* path (`packages/mobile/node_modules/expo/react-native.config.js`) without
 * resolving it to its realpath. Under pnpm's isolated layout `expo-modules-autolinking` is
 * not reachable from that path, so the require throws and `loadConfigAsync` swallows the
 * error and returns null. Android autolinking then falls back to deriving the import from
 * `expo/android/build.gradle`'s `namespace "expo.core"` plus the scanned class name, and
 * writes `import expo.core.ExpoModulesPackage;` into the generated PackageList.java. The
 * real class is `expo.modules.ExpoModulesPackage`, so `:app:compileReleaseJavaWithJavac`
 * dies with "cannot find symbol". npm/yarn hoist the package and never hit this.
 *
 * Restating the import here is the intended escape hatch: expo-modules-autolinking merges
 * the project config over the (missing) library config when resolving each dependency.
 *
 * Re-check this on every Expo SDK upgrade. `__tests__/android-autolinking.test.ts` asserts
 * the generated import stays correct so the build cannot silently break again.
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
        },
      },
    },
  },
};
