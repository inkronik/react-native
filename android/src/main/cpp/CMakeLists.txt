cmake_minimum_required(VERSION 3.22.1)

project(inkronik_crash LANGUAGES CXX)

add_library(inkronik_crash SHARED inkronik_crash.cpp)

target_compile_features(inkronik_crash PRIVATE cxx_std_17)
target_compile_options(
  inkronik_crash
  PRIVATE
    -Wall
    -Wextra
    -Werror
    -fno-exceptions
    -fno-omit-frame-pointer
    -fno-rtti
    -fstack-protector-strong
    -fvisibility=hidden
)
target_compile_definitions(inkronik_crash PRIVATE _FORTIFY_SOURCE=2)
target_link_options(
  inkronik_crash
  PRIVATE
    -Wl,--build-id=sha1
    -Wl,--exclude-libs,libunwind.a
    -Wl,--gc-sections
    -Wl,--no-undefined
    -Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/inkronik_crash.map.txt
    -Wl,-z,max-page-size=16384
    -Wl,-z,noexecstack
    -Wl,-z,now
    -Wl,-z,relro
)
target_link_libraries(inkronik_crash PRIVATE dl)
