#import "INKLowLevelCrashCapture.h"

#import <KSCrash/KSCrash.h>
#import <KSCrash/KSCrashConfiguration.h>
#import <KSCrash/KSCrashReport.h>
#import <KSCrash/KSCrashReportStore.h>

#import "INKNativeStore.h"

static const NSInteger INKMaximumLowLevelReports = 5;
static const NSUInteger INKMaximumLowLevelFrames = 200;

static NSDictionary *INKDictionary(id value)
{
  return [value isKindOfClass:[NSDictionary class]] ? value : @{};
}

static NSArray *INKArray(id value)
{
  return [value isKindOfClass:[NSArray class]] ? value : @[];
}

static NSString *INKString(id value)
{
  return [value isKindOfClass:[NSString class]] ? value : nil;
}

static NSString *INKHexAddress(id value)
{
  if (![value isKindOfClass:[NSNumber class]]) return nil;
  return [NSString stringWithFormat:@"0x%llx", [value unsignedLongLongValue]];
}

static NSURL *INKLowLevelDirectoryURL(void)
{
  NSURL *supportURL = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory
                                                              inDomains:NSUserDomainMask] firstObject];
  return [supportURL URLByAppendingPathComponent:@"InkronikLowLevelCrashes" isDirectory:YES];
}

static void INKProtectDirectory(NSURL *directoryURL)
{
  [[NSFileManager defaultManager] createDirectoryAtURL:directoryURL
                           withIntermediateDirectories:YES
                                            attributes:@{ NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication }
                                                 error:nil];
  [directoryURL setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
}

static NSDictionary<NSString *, NSDictionary *> *INKImagesByAddress(NSDictionary *report)
{
  NSMutableDictionary<NSString *, NSDictionary *> *result = [NSMutableDictionary dictionary];
  for (NSDictionary *image in INKArray(report[@"binary_images"])) {
    NSString *address = INKHexAddress(INKDictionary(image)[@"image_addr"]);
    if (address != nil && result.count < INKMaximumLowLevelFrames) result[address] = INKDictionary(image);
  }
  return result;
}

static NSArray<NSDictionary<NSString *, id> *> *INKFrames(NSDictionary *report)
{
  NSDictionary *crash = INKDictionary(report[@"crash"]);
  NSDictionary *crashedThread = nil;
  for (NSDictionary *thread in INKArray(crash[@"threads"])) {
    if ([INKDictionary(thread)[@"crashed"] boolValue]) {
      crashedThread = INKDictionary(thread);
      break;
    }
  }
  if (crashedThread == nil) return @[];

  NSArray *contents = INKArray(INKDictionary(crashedThread[@"backtrace"])[@"contents"]);
  NSDictionary<NSString *, NSDictionary *> *images = INKImagesByAddress(report);
  NSMutableArray<NSDictionary<NSString *, id> *> *result = [NSMutableArray array];
  for (NSDictionary *rawFrame in [contents subarrayWithRange:NSMakeRange(0, MIN(contents.count, INKMaximumLowLevelFrames))]) {
    NSDictionary *frame = INKDictionary(rawFrame);
    NSString *imageAddress = INKHexAddress(frame[@"object_addr"]);
    NSDictionary *image = imageAddress == nil ? @{} : INKDictionary(images[imageAddress]);
    NSString *rawImagePath = INKString(image[@"name"]);
    NSString *objectName = INKString(frame[@"object_name"]);
    NSString *filename = rawImagePath.lastPathComponent ?: objectName.lastPathComponent ?: @"<unknown>";
    NSString *function = INKString(frame[@"symbol_name"]) ?: @"<unknown>";
    BOOL inApp = rawImagePath != nil && [rawImagePath containsString:@".app/"];
    NSMutableDictionary<NSString *, id> *safeFrame = [@{
      @"function": function,
      @"filename": filename,
      @"inApp": @(inApp),
    } mutableCopy];
    NSString *instructionAddress = INKHexAddress(frame[@"instruction_addr"]);
    NSString *symbolAddress = INKHexAddress(frame[@"symbol_addr"]);
    NSString *imageUUID = INKString(image[@"uuid"]);
    if (instructionAddress != nil) safeFrame[@"instructionAddress"] = instructionAddress;
    if (imageAddress != nil) safeFrame[@"imageAddress"] = imageAddress;
    if (imageUUID != nil) safeFrame[@"imageUuid"] = imageUUID.lowercaseString;
    if (symbolAddress != nil) safeFrame[@"symbolAddress"] = symbolAddress;
    [result addObject:safeFrame];
  }
  return result;
}

static NSString *INKCrashType(NSDictionary *error)
{
  NSDictionary *exception = INKDictionary(error[@"nsexception"]);
  NSString *exceptionName = INKString(exception[@"name"]);
  if (exceptionName != nil) return exceptionName;

  NSDictionary *cppException = INKDictionary(error[@"cpp_exception"]);
  NSString *cppName = INKString(cppException[@"name"]);
  if (cppName != nil) return cppName;

  NSString *errorType = INKString(error[@"type"]);
  return errorType == nil ? @"IOSNativeCrash" : [@"IOSNativeCrash." stringByAppendingString:errorType];
}

static NSString *INKCrashMessage(NSDictionary *error)
{
  NSDictionary *exception = INKDictionary(error[@"nsexception"]);
  NSString *reason = INKString(exception[@"reason"]);
  if (reason != nil) return reason;

  NSDictionary *cppException = INKDictionary(error[@"cpp_exception"]);
  NSString *cppName = INKString(cppException[@"name"]);
  if (cppName != nil) return cppName;

  NSString *signalName = INKString(INKDictionary(error[@"signal"])[@"name"]);
  NSString *machName = INKString(INKDictionary(error[@"mach"])[@"exception_name"]);
  if (signalName != nil && machName != nil) return [NSString stringWithFormat:@"%@ (%@)", signalName, machName];
  return signalName ?: machName ?: @"Native iOS process crash";
}

static NSDate *INKCrashTimestamp(NSDictionary *report)
{
  NSString *timestamp = INKString(INKDictionary(report[@"report"])[@"timestamp"]);
  if (timestamp == nil) return nil;
  static NSISO8601DateFormatter *fractionalFormatter;
  static NSISO8601DateFormatter *wholeSecondFormatter;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    fractionalFormatter = [[NSISO8601DateFormatter alloc] init];
    fractionalFormatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
    wholeSecondFormatter = [[NSISO8601DateFormatter alloc] init];
    wholeSecondFormatter.formatOptions = NSISO8601DateFormatWithInternetDateTime;
  });
  NSDate *date = [fractionalFormatter dateFromString:timestamp];
  if (date != nil) return date;
  return [wholeSecondFormatter dateFromString:timestamp];
}

static NSDictionary *INKCrashContext(NSDictionary *error)
{
  NSDictionary *signal = INKDictionary(error[@"signal"]);
  NSDictionary *mach = INKDictionary(error[@"mach"]);
  NSMutableDictionary *context = [NSMutableDictionary dictionary];
  for (NSString *key in @[@"name", @"signal", @"code", @"code_name"]) {
    id value = signal[key];
    if ([value isKindOfClass:[NSString class]] || [value isKindOfClass:[NSNumber class]]) context[[NSString stringWithFormat:@"signal_%@", key]] = value;
  }
  for (NSString *key in @[@"exception", @"exception_name", @"code", @"code_name", @"subcode"]) {
    id value = mach[key];
    if ([value isKindOfClass:[NSString class]] || [value isKindOfClass:[NSNumber class]]) context[[NSString stringWithFormat:@"mach_%@", key]] = value;
  }
  return context;
}

static BOOL INKConvertReport(KSCrashReportDictionary *rawReport)
{
  NSDictionary *report = rawReport.value;
  NSDictionary *error = INKDictionary(INKDictionary(report[@"crash"])[@"error"]);
  NSArray<NSDictionary<NSString *, id> *> *frames = INKFrames(report);
  NSString *userID = INKString(INKDictionary(report[@"user"])[@"userId"]);
  NSString *eventID = [[INKNativeStore shared] captureType:INKCrashType(error)
                                                   message:INKCrashMessage(error)
                                                   handled:NO
                                                 mechanism:@"ios.low-level"
                                                     stack:nil
                                                    frames:frames
                                                  contexts:@{ @"ios_low_level": INKCrashContext(error) }
                                                 timestamp:INKCrashTimestamp(report)
                                                    userID:userID
                                            useCurrentUser:NO];
  return eventID.length > 0;
}

void INKStartLowLevelCrashCapture(void)
{
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    NSURL *installURL = INKLowLevelDirectoryURL();
    NSURL *reportsURL = [installURL URLByAppendingPathComponent:@"Reports" isDirectory:YES];
    INKProtectDirectory(installURL);
    INKProtectDirectory(reportsURL);

    KSCrashConfiguration *configuration = [[KSCrashConfiguration alloc] init];
    configuration.installPath = installURL.path;
    configuration.monitors = KSCrashMonitorTypeMachException |
      KSCrashMonitorTypeSignal |
      KSCrashMonitorTypeCPPException |
      KSCrashMonitorTypeNSException |
      KSCrashMonitorTypeSystem;
    configuration.enableMemoryIntrospection = NO;
    configuration.enableQueueNameSearch = NO;
    configuration.deadlockWatchdogInterval = 0;
    configuration.addConsoleLogToReport = NO;
    configuration.printPreviousLogOnStartup = NO;
    configuration.enableSwapCxaThrow = YES;
    configuration.enableSigTermMonitoring = NO;
    configuration.reportStoreConfiguration.reportsPath = reportsURL.path;
    configuration.reportStoreConfiguration.maxReportCount = INKMaximumLowLevelReports;
    configuration.reportStoreConfiguration.reportCleanupPolicy = KSCrashReportCleanupPolicyNever;

    NSString *userID = [[[NSUserDefaults alloc] initWithSuiteName:@"com.inkronik.react-native.state"] stringForKey:@"userId"];
    configuration.userInfoJSON = userID == nil ? nil : @{ @"userId": INKSanitizeText(userID, 128) };
    KSCrash *recorder = [KSCrash sharedInstance];
    if ([recorder installWithConfiguration:configuration error:nil]) {
      recorder.reportStore.reportCleanupPolicy = KSCrashReportCleanupPolicyNever;
    }
  });
}

void INKDrainLowLevelCrashReports(void)
{
  INKStartLowLevelCrashCapture();
  KSCrashReportStore *store = [KSCrash sharedInstance].reportStore;
  for (NSNumber *reportID in [store.reportIDs subarrayWithRange:NSMakeRange(0, MIN(store.reportIDs.count, INKMaximumLowLevelReports))]) {
    KSCrashReportDictionary *report = [store reportForID:reportID.longLongValue];
    if (report != nil && INKConvertReport(report)) [store deleteReportWithID:reportID.longLongValue];
  }
}

void INKSetLowLevelCrashUserID(NSString *userID)
{
  INKStartLowLevelCrashCapture();
  [KSCrash sharedInstance].userInfo = userID == nil ? nil : @{ @"userId": INKSanitizeText(userID, 128) };
}

@interface INKLowLevelCrashCaptureLoader : NSObject
@end

@implementation INKLowLevelCrashCaptureLoader

+ (void)load
{
  INKStartLowLevelCrashCapture();
}

@end
