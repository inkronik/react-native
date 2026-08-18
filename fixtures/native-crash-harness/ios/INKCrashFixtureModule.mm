#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

#include <csignal>
#include <cstdlib>
#include <stdexcept>

static NSString *const INKCrashFixtureStateName = @"inkronik-crash-fixture";
static NSString *const INKCrashFixturePendingCaseKey = @"pendingCase";
static NSString *const INKCrashFixtureLaunchArgument = @"--inkronik-crash-case";
static NSString *const INKCrashFixtureResultFileName = @"inkronik-native-crash-harness-result.json";

@interface INKCrashFixtureModule : NSObject <RCTBridgeModule>
+ (NSSet<NSString *> *)caseIDs;
+ (NSURL *)resultURL;
@end

@implementation INKCrashFixtureModule

RCT_EXPORT_MODULE(InkronikCrashFixture)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(prepareCase,
                 prepareCase:(NSString *)caseID
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
#if !DEBUG
  reject(@"INKRONIK_FIXTURE_DISABLED", @"Crash fixtures are disabled outside debug builds", nil);
  return;
#endif
  if (![[self.class caseIDs] containsObject:caseID]) {
    reject(@"INKRONIK_FIXTURE_CASE", @"Unknown crash fixture case", nil);
    return;
  }

  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:INKCrashFixtureStateName];
  [[NSFileManager defaultManager] removeItemAtURL:self.class.resultURL error:nil];
  [defaults setObject:caseID forKey:INKCrashFixturePendingCaseKey];
  resolve(@([defaults synchronize]));
}

RCT_REMAP_METHOD(getRequestedCase,
                 getRequestedCaseWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
  NSUInteger argumentIndex = [arguments indexOfObject:INKCrashFixtureLaunchArgument];
  if (argumentIndex == NSNotFound) {
    resolve(nil);
    return;
  }
  NSUInteger caseIndex = argumentIndex + 1;
  if (caseIndex >= arguments.count || ![[self.class caseIDs] containsObject:arguments[caseIndex]]) {
    reject(@"INKRONIK_FIXTURE_CASE", @"Unknown requested crash fixture case", nil);
    return;
  }
  resolve(arguments[caseIndex]);
}

RCT_REMAP_METHOD(getPendingCase,
                 getPendingCaseWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:INKCrashFixtureStateName];
  resolve([defaults stringForKey:INKCrashFixturePendingCaseKey]);
}

RCT_REMAP_METHOD(clearPendingCase,
                 clearPendingCaseWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:INKCrashFixtureStateName];
  [defaults removeObjectForKey:INKCrashFixturePendingCaseKey];
  resolve(@([defaults synchronize]));
}

RCT_REMAP_METHOD(writeResult,
                 writeResult:(NSString *)resultJSON
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
#if !DEBUG
  reject(@"INKRONIK_FIXTURE_DISABLED", @"Crash fixtures are disabled outside debug builds", nil);
  return;
#endif
  NSData *inputData = [resultJSON dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *input = inputData == nil ? nil : [NSJSONSerialization JSONObjectWithData:inputData options:0 error:nil];
  NSString *caseID = [input[@"caseId"] isKindOfClass:NSString.class] ? input[@"caseId"] : nil;
  NSString *status = [input[@"status"] isKindOfClass:NSString.class] ? input[@"status"] : nil;
  if (caseID == nil || ![[self.class caseIDs] containsObject:caseID] ||
      ![@[ @"failed", @"passed" ] containsObject:status]) {
    reject(@"INKRONIK_FIXTURE_RESULT", @"Invalid crash fixture result", nil);
    return;
  }
  NSString *message = [input[@"message"] isKindOfClass:NSString.class] ? input[@"message"] : @"";
  if (message.length > 512) message = [message substringToIndex:512];
  NSDictionary *result = @{ @"caseId" : caseID, @"message" : message, @"status" : status };
  NSData *outputData = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
  BOOL written = outputData != nil && [outputData writeToURL:self.class.resultURL options:NSDataWritingAtomic error:nil];
  if (!written) {
    reject(@"INKRONIK_FIXTURE_RESULT", @"Could not persist crash fixture result", nil);
    return;
  }
  resolve(@YES);
}

RCT_EXPORT_METHOD(trigger:(NSString *)caseID)
{
#if DEBUG
  NSAssert([[self.class caseIDs] containsObject:caseID], @"Unknown crash fixture case");
  dispatch_async(dispatch_get_main_queue(), ^{
    if ([caseID isEqualToString:@"ios.native-sigsegv"]) {
      std::raise(SIGSEGV);
      return;
    }
    if ([caseID isEqualToString:@"ios.native-abort"]) {
      std::abort();
      return;
    }
    if ([caseID isEqualToString:@"ios.native-nsexception"]) {
      @throw [NSException exceptionWithName:@"InkronikFixtureException"
                                     reason:@"Inkronik destructive fixture NSException"
                                   userInfo:nil];
    }
    if ([caseID isEqualToString:@"ios.native-cpp"]) {
      throw std::runtime_error("Inkronik destructive fixture C++ exception");
    }
    if ([caseID isEqualToString:@"ios.hang"]) {
      [NSThread sleepForTimeInterval:30];
    }
  });
#else
  (void)caseID;
#endif
}

+ (NSSet<NSString *> *)caseIDs
{
  return [NSSet setWithArray:@[
    @"ios.native-sigsegv",
    @"ios.native-abort",
    @"ios.native-nsexception",
    @"ios.native-cpp",
    @"ios.hang",
  ]];
}

+ (NSURL *)resultURL
{
  NSURL *cacheURL = [[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
  return [cacheURL URLByAppendingPathComponent:INKCrashFixtureResultFileName];
}

@end
