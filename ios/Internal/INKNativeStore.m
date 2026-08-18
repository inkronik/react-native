#import "INKNativeStore.h"

static const NSUInteger INKDefaultMaximumItems = 30;
static const NSTimeInterval INKDefaultTTLSeconds = 86400;
static const NSUInteger INKMaximumEventBytes = 200000;

NSString *INKSanitizeText(NSString *value, NSUInteger maximumLength)
{
  if (value.length == 0) {
    return @"";
  }

  NSArray<NSString *> *patterns = @[
    @"(?i)(authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token)\\s*[:=]\\s*([^\\s,;]+)",
    @"(?i)bearer\\s+[A-Za-z0-9._~+/-]{8,}",
    @"([?&])[^#\\s]+",
  ];
  NSString *result = [value copy];
  for (NSString *pattern in patterns) {
    NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
    NSString *replacement = [pattern hasPrefix:@"(?i)bearer"] ? @"Bearer [REDACTED]" :
      ([pattern hasPrefix:@"([?&])"] ? @"" : @"$1=[REDACTED]");
    result = [expression stringByReplacingMatchesInString:result options:0 range:NSMakeRange(0, result.length) withTemplate:replacement];
  }

  return result.length <= maximumLength ? result : [result substringToIndex:maximumLength];
}

@interface INKNativeStore ()

@property(nonatomic, strong) NSURL *directoryURL;
@property(nonatomic, strong) NSUserDefaults *defaults;
@property(nonatomic, strong) dispatch_queue_t queue;

@end

@implementation INKNativeStore

+ (instancetype)shared
{
  static INKNativeStore *store;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    store = [[INKNativeStore alloc] initPrivate];
  });
  return store;
}

- (instancetype)initPrivate
{
  self = [super init];
  if (self) {
    NSURL *supportURL = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask] firstObject];
    _directoryURL = [supportURL URLByAppendingPathComponent:@"InkronikNativeEvents" isDirectory:YES];
    _defaults = [[NSUserDefaults alloc] initWithSuiteName:@"com.inkronik.react-native.state"];
    _queue = dispatch_queue_create("com.inkronik.react-native.store", DISPATCH_QUEUE_SERIAL);
    [[NSFileManager defaultManager] createDirectoryAtURL:_directoryURL withIntermediateDirectories:YES attributes:@{
      NSFileProtectionKey: NSFileProtectionCompleteUntilFirstUserAuthentication,
    } error:nil];
    [_directoryURL setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];
  }
  return self;
}

- (instancetype)init
{
  [NSException raise:NSInternalInconsistencyException format:@"Use shared"];
  return nil;
}

- (void)configure:(NSString *)configurationJSON
{
  NSData *data = [configurationJSON dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *configuration = data == nil ? nil : [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![configuration isKindOfClass:[NSDictionary class]]) {
    return;
  }

  NSNumber *ttlMilliseconds = configuration[@"cacheItemTtlMs"];
  NSNumber *maximumItems = configuration[@"maxCacheItems"];
  [_defaults setDouble:MAX(1, MIN(604800, ttlMilliseconds.doubleValue / 1000.0)) forKey:@"ttlSeconds"];
  [_defaults setInteger:MAX(0, MIN(100, maximumItems.integerValue)) forKey:@"maximumItems"];
  [self setOptionalString:configuration[@"release"] forKey:@"release"];
  [self setOptionalString:configuration[@"dist"] forKey:@"dist"];
  [self setOptionalString:configuration[@"environment"] forKey:@"environment"];
  [self prune];
}

- (void)setUserID:(NSString *)userID
{
  [self setOptionalString:userID == nil ? nil : INKSanitizeText(userID, 128) forKey:@"userId"];
}

- (NSString *)captureType:(NSString *)type
                  message:(NSString *)message
                  handled:(BOOL)handled
                mechanism:(NSString *)mechanism
                    stack:(NSString *)stack
                   frames:(NSArray<NSDictionary<NSString *,id> *> *)frames
                 contexts:(NSDictionary<NSString *,NSDictionary<NSString *,id> *> *)contexts
                timestamp:(NSDate *)timestamp
                   userID:(NSString *)userID
           useCurrentUser:(BOOL)useCurrentUser
{
  if ([self maximumItems] == 0) {
    return @"";
  }

  NSString *eventID = [[[NSUUID UUID] UUIDString] stringByReplacingOccurrencesOfString:@"-" withString:@""];
  NSMutableDictionary *event = [@{
    @"id": eventID.lowercaseString,
    @"timestamp": [self isoTimestamp:timestamp ?: [NSDate date]],
    @"platform": @"ios",
    @"level": handled ? @"error" : @"fatal",
    @"type": INKSanitizeText(type, 256),
    @"message": INKSanitizeText(message, 2000),
    @"handled": @(handled),
    @"mechanism": INKSanitizeText(mechanism, 128),
    @"contexts": [self contextsByMerging:contexts],
  } mutableCopy];
  NSString *safeStack = stack == nil ? nil : INKSanitizeText(stack, 100000);
  NSString *resolvedUserID = useCurrentUser ? [_defaults stringForKey:@"userId"] : userID;
  if (safeStack != nil) event[@"stack"] = safeStack;
  if (frames.count > 0) event[@"frames"] = [self sanitizedFrames:frames];
  if (resolvedUserID != nil) event[@"userId"] = INKSanitizeText(resolvedUserID, 128);

  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  if (data == nil || data.length > INKMaximumEventBytes) {
    return @"";
  }

  dispatch_sync(_queue, ^{
    NSURL *eventURL = [self.directoryURL URLByAppendingPathComponent:[eventID.lowercaseString stringByAppendingString:@".json"]];
    [data writeToURL:eventURL options:NSDataWritingAtomic | NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication error:nil];
    [self pruneLocked];
  });
  return eventID.lowercaseString;
}

- (NSArray<NSDictionary<NSString *, id> *> *)sanitizedFrames:(NSArray<NSDictionary<NSString *, id> *> *)frames
{
  NSMutableArray<NSDictionary<NSString *, id> *> *result = [NSMutableArray array];
  for (NSDictionary<NSString *, id> *frame in [frames subarrayWithRange:NSMakeRange(0, MIN(frames.count, 200))]) {
    NSString *function = [frame[@"function"] isKindOfClass:[NSString class]] ? frame[@"function"] : @"<unknown>";
    NSString *filename = [frame[@"filename"] isKindOfClass:[NSString class]] ? frame[@"filename"] : @"<unknown>";
    NSMutableDictionary<NSString *, id> *safeFrame = [@{
      @"function": INKSanitizeText(function, 512),
      @"filename": INKSanitizeText(filename, 512),
      @"inApp": @([frame[@"inApp"] boolValue]),
    } mutableCopy];
    for (NSString *key in @[@"instructionAddress", @"imageAddress", @"imageUuid", @"symbolAddress"]) {
      NSString *value = [frame[key] isKindOfClass:[NSString class]] ? frame[key] : nil;
      if (value != nil) safeFrame[key] = INKSanitizeText(value, 64);
    }
    [result addObject:safeFrame];
  }
  return result;
}

- (NSString *)drain
{
  __block NSString *result = @"[]";
  dispatch_sync(_queue, ^{
    [self pruneLocked];
    NSMutableArray *events = [NSMutableArray array];
    for (NSURL *URL in [self eventURLs]) {
      NSData *data = [NSData dataWithContentsOfURL:URL options:NSDataReadingMappedIfSafe error:nil];
      id event = data == nil ? nil : [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if ([event isKindOfClass:[NSDictionary class]]) [events addObject:event];
    }
    NSData *data = [NSJSONSerialization dataWithJSONObject:events options:0 error:nil];
    if (data != nil) result = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"[]";
  });
  return result;
}

- (BOOL)acknowledge:(NSString *)eventIDsJSON
{
  NSData *data = [eventIDsJSON dataUsingEncoding:NSUTF8StringEncoding];
  NSArray *eventIDs = data == nil ? nil : [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![eventIDs isKindOfClass:[NSArray class]]) return NO;

  NSSet *accepted = [NSSet setWithArray:eventIDs];
  dispatch_sync(_queue, ^{
    for (NSURL *URL in [self eventURLs]) {
      if ([accepted containsObject:[URL.lastPathComponent stringByDeletingPathExtension]]) {
        [[NSFileManager defaultManager] removeItemAtURL:URL error:nil];
      }
    }
  });
  return YES;
}

- (void)prune
{
  dispatch_sync(_queue, ^{ [self pruneLocked]; });
}

- (void)pruneLocked
{
  NSArray<NSURL *> *URLs = [self eventURLs];
  NSDate *cutoff = [NSDate dateWithTimeIntervalSinceNow:-[self ttlSeconds]];
  NSMutableArray<NSURL *> *retained = [NSMutableArray array];
  for (NSURL *URL in URLs) {
    NSDate *modified = nil;
    [URL getResourceValue:&modified forKey:NSURLContentModificationDateKey error:nil];
    if (modified == nil || [modified compare:cutoff] == NSOrderedAscending) {
      [[NSFileManager defaultManager] removeItemAtURL:URL error:nil];
    } else {
      [retained addObject:URL];
    }
  }
  NSInteger overflow = MAX(0, retained.count - [self maximumItems]);
  for (NSInteger index = 0; index < overflow; index += 1) {
    [[NSFileManager defaultManager] removeItemAtURL:retained[index] error:nil];
  }
}

- (NSArray<NSURL *> *)eventURLs
{
  NSArray *keys = @[NSURLContentModificationDateKey, NSURLFileSizeKey];
  NSArray<NSURL *> *URLs = [[NSFileManager defaultManager] contentsOfDirectoryAtURL:_directoryURL includingPropertiesForKeys:keys options:0 error:nil] ?: @[];
  NSPredicate *predicate = [NSPredicate predicateWithBlock:^BOOL(NSURL *URL, __unused NSDictionary *bindings) {
    NSNumber *size = nil;
    [URL getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
    return [URL.pathExtension isEqualToString:@"json"] && size.unsignedIntegerValue <= INKMaximumEventBytes;
  }];
  return [[URLs filteredArrayUsingPredicate:predicate] sortedArrayUsingComparator:^NSComparisonResult(NSURL *left, NSURL *right) {
    NSDate *leftDate = nil;
    NSDate *rightDate = nil;
    [left getResourceValue:&leftDate forKey:NSURLContentModificationDateKey error:nil];
    [right getResourceValue:&rightDate forKey:NSURLContentModificationDateKey error:nil];
    return [leftDate ?: [NSDate distantPast] compare:rightDate ?: [NSDate distantPast]];
  }];
}

- (NSDictionary *)contextsByMerging:(NSDictionary *)contexts
{
  NSMutableDictionary *app = [NSMutableDictionary dictionary];
  for (NSString *key in @[@"release", @"dist", @"environment"]) {
    NSString *value = [_defaults stringForKey:key];
    if (value != nil) app[key] = value;
  }
  NSMutableDictionary *result = [contexts mutableCopy] ?: [NSMutableDictionary dictionary];
  result[@"app"] = app;
  return result;
}

- (void)setOptionalString:(id)value forKey:(NSString *)key
{
  if ([value isKindOfClass:[NSString class]] && [value length] > 0) {
    [_defaults setObject:INKSanitizeText(value, 256) forKey:key];
  } else {
    [_defaults removeObjectForKey:key];
  }
}

- (NSUInteger)maximumItems
{
  return [_defaults objectForKey:@"maximumItems"] == nil ? INKDefaultMaximumItems : [_defaults integerForKey:@"maximumItems"];
}

- (NSTimeInterval)ttlSeconds
{
  return [_defaults objectForKey:@"ttlSeconds"] == nil ? INKDefaultTTLSeconds : [_defaults doubleForKey:@"ttlSeconds"];
}

- (NSString *)isoTimestamp:(NSDate *)date
{
  static NSISO8601DateFormatter *formatter;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    formatter = [[NSISO8601DateFormatter alloc] init];
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
  });
  return [formatter stringFromDate:date];
}

@end
