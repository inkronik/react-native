Pod::Spec.new do |s|
  s.name = "InkronikNativeCrashFixture"
  s.version = "0.1.0"
  s.summary = "Destructive native crash fixture for Inkronik development tests."
  s.homepage = "https://github.com/inkronik/react-native"
  s.license = { :type => "MIT", :file => "../../LICENSE" }
  s.author = { "Inkronik" => "security@inkronik.com" }
  s.source = { :git => "https://github.com/inkronik/react-native.git", :tag => s.version.to_s }
  s.platforms = { :ios => "15.1" }
  s.source_files = "ios/*.{h,mm}"
  s.requires_arc = true
  s.compiler_flags = "-Wall -Wextra -Werror -fexceptions -fcxx-exceptions"
  s.dependency "React-Core", "0.83.4"
end
