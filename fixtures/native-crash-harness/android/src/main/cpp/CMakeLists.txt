cmake_minimum_required(VERSION 3.22.1)

project(inkronik_crash_fixture LANGUAGES CXX)

add_library(inkronik_crash_fixture SHARED inkronik_crash_fixture.cpp)

target_compile_features(inkronik_crash_fixture PRIVATE cxx_std_20)
target_compile_options(inkronik_crash_fixture PRIVATE -fexceptions -frtti -Wall -Wextra -Werror)
