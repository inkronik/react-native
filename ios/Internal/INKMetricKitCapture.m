#import <Foundation/Foundation.h>
#import <MetricKit/MetricKit.h>
#import "INKNativeStore.h"

API_AVAILABLE(ios(13.0))
@interface INKMetricKitCapture : NSObject <MXMetricManagerSubscriber>
@end

@implementation INKMetricKitCapture

+ (void)load
{
  if (@available(iOS 13.0, *)) {
    static INKMetricKitCapture *subscriber;
    subscriber = [[INKMetricKitCapture alloc] init];
    [[MXMetricManager sharedManager] addSubscriber:subscriber];
  }
}

- (void)didReceiveDiagnosticPayloads:(NSArray<MXDiagnosticPayload *> *)payloads
{
  for (MXDiagnosticPayload *payload in payloads) {
    for (MXCrashDiagnostic *diagnostic in payload.crashDiagnostics ?: @[]) {
      [self captureCrash:diagnostic];
    }
    for (MXHangDiagnostic *diagnostic in payload.hangDiagnostics ?: @[]) {
      [self captureHang:diagnostic];
    }
  }
}

- (void)captureCrash:(MXCrashDiagnostic *)diagnostic
{
  NSString *stack = [self JSONString:[diagnostic.callStackTree JSONRepresentation]];
  NSDictionary *context = @{
    @"exception_type": diagnostic.exceptionType ?: @0,
    @"exception_code": diagnostic.exceptionCode ?: @0,
    @"signal": diagnostic.signal ?: @0,
  };
  [[INKNativeStore shared] captureType:@"IOSCrash"
                               message:diagnostic.terminationReason ?: @"iOS process crash"
                               handled:NO
                             mechanism:@"ios.metrickit-crash"
                                 stack:stack
                                frames:@[]
                              contexts:@{ @"ios_crash": context }
                             timestamp:nil
                                userID:nil
                        useCurrentUser:YES];
}

- (void)captureHang:(MXHangDiagnostic *)diagnostic
{
  NSString *stack = [self JSONString:[diagnostic.callStackTree JSONRepresentation]];
  [[INKNativeStore shared] captureType:@"IOSHang"
                               message:@"The main thread was unresponsive"
                               handled:NO
                             mechanism:@"ios.metrickit-hang"
                                 stack:stack
                                frames:@[]
                              contexts:@{ @"ios_hang": @{ @"duration_seconds": @(diagnostic.hangDuration.doubleValue) } }
                             timestamp:nil
                                userID:nil
                        useCurrentUser:YES];
}

- (NSString *)JSONString:(NSData *)data
{
  if (data == nil || data.length > 100000) return nil;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

@end
