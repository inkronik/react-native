#include <csignal>
#include <cstdlib>
#include <jni.h>
#include <stdexcept>

extern "C" JNIEXPORT void JNICALL
Java_com_inkronik_crashfixture_InkronikCrashFixtureModule_nativeSegmentationFault(JNIEnv *, jobject)
{
  std::raise(SIGSEGV);
}

extern "C" JNIEXPORT void JNICALL
Java_com_inkronik_crashfixture_InkronikCrashFixtureModule_nativeAbort(JNIEnv *, jobject)
{
  std::abort();
}

extern "C" JNIEXPORT void JNICALL
Java_com_inkronik_crashfixture_InkronikCrashFixtureModule_nativeCppException(JNIEnv *, jobject)
{
  throw std::runtime_error("Inkronik destructive fixture C++ exception");
}
