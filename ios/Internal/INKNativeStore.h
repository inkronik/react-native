#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface INKNativeStore : NSObject

+ (instancetype)shared;
- (void)configure:(NSString *)configurationJSON;
- (void)setUserID:(nullable NSString *)userID;
- (NSString *)captureType:(NSString *)type
                  message:(NSString *)message
                  handled:(BOOL)handled
                 mechanism:(NSString *)mechanism
                    stack:(nullable NSString *)stack
                   frames:(NSArray<NSDictionary<NSString *, id> *> *)frames
                 contexts:(NSDictionary<NSString *, NSDictionary<NSString *, id> *> *)contexts
                timestamp:(nullable NSDate *)timestamp
                   userID:(nullable NSString *)userID
           useCurrentUser:(BOOL)useCurrentUser;
- (NSString *)drain;
- (BOOL)acknowledge:(NSString *)eventIDsJSON;

@end

FOUNDATION_EXPORT NSString *INKSanitizeText(NSString *value, NSUInteger maximumLength);

NS_ASSUME_NONNULL_END
