#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface InkronikNative : NSObject

+ (NSString *)captureHandledError:(NSError *)error mechanism:(NSString *)mechanism;
+ (NSString *)captureHandledException:(NSException *)exception mechanism:(NSString *)mechanism;

@end

NS_ASSUME_NONNULL_END
