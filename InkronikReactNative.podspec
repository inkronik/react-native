require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "InkronikReactNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = { "Inkronik" => "security@inkronik.com" }
  s.platforms    = { :ios => "12.0" }
  s.source       = { :git => "https://github.com/inkronik/react-native.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,mm}"
  s.private_header_files = "ios/Internal/**/*.h"
  s.weak_frameworks = "MetricKit"
  s.dependency "KSCrash/Recording", "2.5.1"
  s.dependency "React-Core"
end
