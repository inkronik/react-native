#import "Inkronik.h"
#import "Internal/INKLowLevelCrashCapture.h"
#import "Internal/INKNativeStore.h"

@implementation Inkronik

RCT_EXPORT_MODULE(Inkronik)

RCT_EXPORT_METHOD(configure:(NSString *)configurationJson)
{
  [[INKNativeStore shared] configure:configurationJson];
}

RCT_EXPORT_METHOD(drainPendingEvents:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  INKDrainLowLevelCrashReports();
  resolve([[INKNativeStore shared] drain]);
}

RCT_EXPORT_METHOD(acknowledgeEvents:(NSString *)eventIdsJson
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  resolve(@([[INKNativeStore shared] acknowledge:eventIdsJson]));
}

RCT_EXPORT_METHOD(setUserId:(NSString *)userId)
{
  [[INKNativeStore shared] setUserID:userId];
  INKSetLowLevelCrashUserID(userId);
}

@end
