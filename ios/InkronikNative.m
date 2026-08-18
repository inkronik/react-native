#import "InkronikNative.h"
#import "Internal/INKNativeStore.h"

@implementation InkronikNative

+ (NSString *)captureHandledError:(NSError *)error mechanism:(NSString *)mechanism
{
  return [[INKNativeStore shared] captureType:error.domain
                                      message:error.localizedDescription
                                      handled:YES
                                    mechanism:mechanism
                                        stack:error.userInfo[NSDebugDescriptionErrorKey]
                                       frames:@[]
                                     contexts:@{ @"native_error": @{ @"code": @(error.code) } }
                                    timestamp:nil
                                       userID:nil
                               useCurrentUser:YES];
}

+ (NSString *)captureHandledException:(NSException *)exception mechanism:(NSString *)mechanism
{
  return [[INKNativeStore shared] captureType:exception.name
                                      message:exception.reason ?: @"Handled native exception"
                                      handled:YES
                                    mechanism:mechanism
                                        stack:[exception.callStackSymbols componentsJoinedByString:@"\n"]
                                       frames:@[]
                                     contexts:@{}
                                    timestamp:nil
                                       userID:nil
                               useCurrentUser:YES];
}

@end
