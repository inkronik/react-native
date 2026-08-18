#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT void INKStartLowLevelCrashCapture(void);
FOUNDATION_EXPORT void INKDrainLowLevelCrashReports(void);
FOUNDATION_EXPORT void INKSetLowLevelCrashUserID(NSString * _Nullable userID);

NS_ASSUME_NONNULL_END
