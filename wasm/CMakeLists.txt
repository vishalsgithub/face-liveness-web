# Builds the engine to WebAssembly (ES module + .wasm) with Emscripten.
#   emcmake cmake -S wasm -B build/simd -DNCNN_VARIANT=simd && cmake --build build/simd
# Variants: simd (default, all current browsers) and basic (fallback without wasm SIMD).

cmake_minimum_required(VERSION 3.13)
project(face_liveness_wasm CXX)

set(CMAKE_CXX_STANDARD 14)
set(NCNN_VARIANT "simd" CACHE STRING "ncnn webassembly variant: simd or basic")
set(NCNN_WASM_DIR "" CACHE PATH "Path to ncnn-<version>-webassembly")
set(ENGINE_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp" CACHE PATH "C API + core sources")

set(ncnn_DIR "${NCNN_WASM_DIR}/${NCNN_VARIANT}/lib/cmake/ncnn")
find_package(ncnn REQUIRED)

set(TARGET_NAME face_liveness_${NCNN_VARIANT})
add_executable(${TARGET_NAME}
  ${ENGINE_SRC_DIR}/face_liveness.cpp
  ${ENGINE_SRC_DIR}/core/src/face_anti_spoofing.cpp
)
target_include_directories(${TARGET_NAME} PRIVATE
  ${ENGINE_SRC_DIR}
  ${ENGINE_SRC_DIR}/core/include
  "${NCNN_WASM_DIR}/${NCNN_VARIANT}/include"   # for <ncnn/net.h>
)
target_link_libraries(${TARGET_NAME} PRIVATE ncnn)

if(NCNN_VARIANT STREQUAL "simd")
  target_compile_options(${TARGET_NAME} PRIVATE -msimd128)
endif()

target_compile_options(${TARGET_NAME} PRIVATE -O3)
target_link_options(${TARGET_NAME} PRIVATE
  -O3
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createFaceLivenessModule
  -sENVIRONMENT=web,worker
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=64MB
  -sFORCE_FILESYSTEM=1
  -sEXPORTED_FUNCTIONS=['_fl_create','_fl_destroy','_fl_load','_fl_set_options','_fl_detect','_malloc','_free']
  -sEXPORTED_RUNTIME_METHODS=['FS','HEAPU8','HEAPF32','UTF8ToString','stringToNewUTF8']
)
